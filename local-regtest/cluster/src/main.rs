//! Stands up a local Spark operator cluster and holds it open, printing the
//! config the browser needs to reach it and serving what a wallet cannot do for
//! itself here: funding, and the watchtower exit scenario.
//!
//! The cluster comes from the sdk's own test fixtures, so it is the same one the
//! sdk tests against rather than a second implementation of it.

use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use anyhow::{Context, Result, bail, ensure};
use bip39::Mnemonic;
use bitcoin::{Amount, Transaction, Txid};
use serde_json::{Value, json};
use spark_itest::fixtures::bitcoind::BitcoindFixture;
use spark_itest::fixtures::keyshares::MIN_AVAILABLE_KEYS;
use spark_itest::fixtures::network::ClusterNetwork;
use spark_itest::fixtures::setup::{FixtureId, create_test_signer_alice, create_test_signer_bob};
use spark_itest::fixtures::spark_so::{MIN_SIGNERS, SparkSoFixture, StateSource};
use spark_itest::helpers::{
    deposit_with_amount, fund_p2tr_utxo, sign_cpfp_psbt_p2tr, wait_for_event,
};
use spark_wallet::{
    CpfpInput, DefaultSigner, LeafOptimizationOptions, Network, OperatorConfig, OperatorPoolConfig,
    PublicKey, RetryConfig, ServiceProviderConfig, SparkAddress, SparkSignerAdapter, SparkWallet,
    SparkWalletConfig, TokenOutputsOptimizationOptions, TreeNode, TreeNodeId, WalletEvent,
    build_cpfp_child, csv_timelock, identity_public_key, p2tr_key_path_input_weight,
};
use std::str::FromStr;

/// The phrase the local-regtest docs tell you to restore in the app.
const DEFAULT_FUND_MNEMONIC: &str =
    "legal winner thank year wave sausage worth useful legal winner thank yellow";

/// The coin the cluster spends to confirm a tree root, and the fee rate it pays.
const ROOT_FEE_COIN_SATS: u64 = 20_000;
const ROOT_FEE_RATE_SAT_PER_KW: u64 = 500;

/// A wallet renews a leaf on the 19th transfer since its last renewal. The
/// count is the sdk's to change, so `renewed_leaf` bounds its loop by this
/// rather than counting on 19.
const MAX_TRANSFERS_PER_RENEWAL: u32 = 25;

/// The regtest Spark address a phrase owns.
fn spark_address_of(phrase: &str) -> Result<String> {
    let seed = Mnemonic::from_str(phrase.trim())?.to_seed("");
    let address = SparkAddress {
        identity_public_key: identity_public_key(&seed, Network::Regtest, None)?,
        network: Network::Regtest,
        spark_invoice_fields: None,
    };
    Ok(address.to_address_string()?)
}

/// The cluster the sdk's `TestFixtures` holds, started from nothing instead.
/// `TestFixtures` restores a state snapshot that only the sdk's own tooling
/// captures, so here the operators generate their keyshares as they start.
struct Cluster {
    bitcoind: BitcoindFixture,
    spark_so: SparkSoFixture,
    // Last, so it is dropped after the containers on it.
    _network: ClusterNetwork,
}

impl Cluster {
    async fn start() -> Result<Self> {
        let id = FixtureId::new();
        let network = ClusterNetwork::create(&id)?;
        let mut bitcoind = BitcoindFixture::new(&id).await?;
        bitcoind.initialize().await?;
        let mut spark_so = SparkSoFixture::new_with_keyshares(
            &id,
            &bitcoind,
            StateSource::Dkg {
                target: MIN_AVAILABLE_KEYS,
            },
        )
        .await?;
        spark_so.initialize().await?;
        Ok(Self {
            bitcoind,
            spark_so,
            _network: network,
        })
    }

    /// A wallet config for a client on this machine, with no service provider.
    fn wallet_config(&self) -> Result<SparkWalletConfig> {
        let mut operators = Vec::new();
        for operator in &self.spark_so.operators {
            operators.push(OperatorConfig {
                address: format!("https://127.0.0.1:{}", operator.host_port).parse()?,
                ca_cert: Some(operator.ca_cert.as_bytes().to_vec()),
                id: operator.index,
                identifier: operator.identifier,
                identity_public_key: operator.public_key,
                user_agent: None,
            });
        }
        Ok(SparkWalletConfig {
            network: Network::Regtest,
            operator_pool: OperatorPoolConfig::new(0, operators)?,
            split_secret_threshold: MIN_SIGNERS as u32,
            reconnect_interval_seconds: 1,
            service_provider_config: ServiceProviderConfig {
                base_url: String::new(),
                schema_endpoint: None,
                identity_public_key: PublicKey::from_slice(&[2; 33])?,
                user_agent: None,
                retry_config: RetryConfig::default(),
            },
            tokens_config: SparkWalletConfig::default_tokens_config(),
            leaf_optimization_options: LeafOptimizationOptions::default(),
            leaf_auto_optimize_enabled: false,
            token_outputs_optimization_options: TokenOutputsOptimizationOptions {
                min_outputs_threshold: 50,
                target_output_count: 5,
                auto_optimize_interval: None,
            },
            self_payment_allowed: false,
            max_concurrent_claims: 1,
            fee_ladder_enabled: true,
        })
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,testcontainers=warn".into()),
        )
        .init();

    // `cluster.mjs` builds the operator images under the tags the fixtures run.
    if std::env::args().nth(1).as_deref() == Some("image-tags") {
        let tags = json!({
            "spark-so": spark_itest::images::reference(spark_itest::images::SPARK_SO)?,
            "spark-migrations": spark_itest::images::reference(spark_itest::images::MIGRATIONS)?,
        });
        println!("{tags}");
        return Ok(());
    }

    eprintln!("Starting cluster (bitcoind + postgres + 3 operators)...");
    let fixtures = Cluster::start().await?;

    let operators: Vec<_> = fixtures
        .spark_so
        .operators
        .iter()
        .map(|op| {
            json!({
                "id": op.index,
                "identifier": hex::encode(op.identifier.serialize()),
                "address": format!("https://127.0.0.1:{}", op.host_port),
                "identityPublicKey": hex::encode(op.public_key.serialize()),
                "caCertPem": op.ca_cert,
            })
        })
        .collect();

    let coordinator = &fixtures.spark_so.operators[0];
    let config = json!({
        "coordinatorIdentifier": hex::encode(coordinator.identifier.serialize()),
        "threshold": MIN_SIGNERS,
        "signingOperators": operators,
        "sspConfig": {
            "baseUrl": "",
            "identityPublicKey": hex::encode([2u8; 33]),
            "schemaEndpoint": null,
        },
        "expectedWithdrawBondSats": 10000,
        "expectedWithdrawRelativeBlockLocktime": 1000,
        "bitcoind": {
            "rpcUrl": fixtures.bitcoind.rpc_url,
            "rpcUser": fixtures.bitcoind.rpcuser,
            "rpcPassword": fixtures.bitcoind.rpcpassword,
        },
    });

    // A wallet in the browser cannot claim its own deposit here: that path runs
    // through a service provider, which a local cluster does not have. Funding
    // it means depositing with a wallet that can, then sending a Spark transfer.
    let funder = SparkWallet::connect(
        fixtures.wallet_config()?,
        Arc::new(SparkSignerAdapter::new(
            Arc::new(create_test_signer_alice()),
        )),
    )
    .await?;
    // `deposit_with_amount` waits for a DepositConfirmed event, which only
    // arrives once the wallet is processing the operators' event stream.
    funder.start_background_processing().await;

    // The address is derived from the phrase the app will be restored with, so
    // the cluster funds a wallet that does not exist yet and nobody has to start
    // it twice. FUND_SPARK_ADDRESS still wins if you already have an address.
    let default_target = match std::env::var("FUND_SPARK_ADDRESS") {
        Ok(address) => address,
        Err(_) => spark_address_of(
            &std::env::var("FUND_MNEMONIC").unwrap_or_else(|_| DEFAULT_FUND_MNEMONIC.to_string()),
        )?,
    };
    let startup_rounds: u32 = std::env::var("FUND_COUNT")
        .unwrap_or_else(|_| "0".to_string())
        .parse()?;
    let default_sats: u64 = std::env::var("FUND_SATS")
        .unwrap_or_else(|_| "1000000".to_string())
        .parse()?;
    if startup_rounds > 0 {
        fund(
            &funder,
            &fixtures,
            &default_target,
            default_sats,
            startup_rounds,
        )
        .await?;
    }

    let rendered = serde_json::to_string_pretty(&config)?;
    let out = std::env::var("REGTEST_CONFIG_OUT")
        .unwrap_or_else(|_| "/tmp/spark-regtest.json".to_string());
    std::fs::File::create(&out)?.write_all(rendered.as_bytes())?;

    println!("{rendered}");
    eprintln!("\nCluster up. Config written to {out}");
    let port: u16 = std::env::var("FUND_PORT")
        .unwrap_or_else(|_| "8997".to_string())
        .parse()?;
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    eprintln!("Fund on demand: curl 'http://127.0.0.1:{port}/fund?sats=200000&count=3'");
    eprintln!("Press Ctrl-C to tear down.\n");

    let mut renewed_leaves = Vec::new();
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                // One at a time: funding drives the one funder wallet, and two
                // deposits racing through it would interleave their syncs.
                if let Err(e) = serve(stream, &funder, &fixtures, &default_target, default_sats, &mut renewed_leaves).await {
                    eprintln!("request failed: {e}");
                }
            }
        }
    }
    eprintln!("Shutting down.");
    Ok(())
}

/// Deposits `sats` into `wallet` and waits until the wallet can spend the leaf.
async fn deposit(wallet: &SparkWallet, fixtures: &Cluster, sats: u64) -> Result<()> {
    deposit_with_amount(wallet, &fixtures.bitcoind, sats).await?;
    // The claimed leaf is not spendable until the wallet has synced it.
    for _ in 0..30 {
        wallet.sync().await?;
        if wallet.get_balance().await? >= sats {
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Ok(())
}

/// Deposits `sats` and forwards it to `target`, once per round. Each round lands
/// as its own leaf in the receiver: leaf optimization is off, so nothing merges
/// them afterwards.
async fn fund(
    funder: &SparkWallet,
    fixtures: &Cluster,
    target: &str,
    sats: u64,
    rounds: u32,
) -> Result<()> {
    eprintln!("Funding {target} with {rounds} x {sats} sats...");
    let address = SparkAddress::from_str(target)?;
    for round in 1..=rounds {
        // Deposit exactly what is being sent: a transfer for less than the whole
        // leaf has nothing to split it with.
        deposit(funder, fixtures, sats).await?;
        let transfer = funder.transfer(sats, &address, None).await?;
        eprintln!(
            "Round {round}/{rounds}: transferred {sats} sats ({:?})",
            transfer.id
        );
    }
    Ok(())
}

/// A renewed leaf the cluster sent to a wallet, with the split nodes above it.
struct RenewedLeaf {
    leaf: TreeNode,
    /// Root first, as they stood when the cluster sent the leaf. The operators
    /// never rewrite a split node once they have created it.
    ancestors: Vec<TreeNode>,
}

/// A wallet of the cluster's own, on a key nothing else uses.
async fn scratch_wallet(fixtures: &Cluster, signer: DefaultSigner) -> Result<SparkWallet> {
    let wallet = SparkWallet::connect(
        fixtures.wallet_config()?,
        Arc::new(SparkSignerAdapter::new(Arc::new(signer))),
    )
    .await?;
    // Subscribed before starting: the wallet reports its first sync once.
    let mut events = wallet.subscribe_events();
    wallet.start_background_processing().await;
    wait_for_event(&mut events, 60, "Synced", |event| {
        Ok(matches!(event, WalletEvent::Synced).then_some(event))
    })
    .await?;
    Ok(wallet)
}

/// The one leaf a scratch wallet holds.
async fn only_leaf(wallet: &SparkWallet) -> Result<TreeNodeId> {
    let leaves = wallet.list_leaves().await?.available;
    ensure!(
        leaves.len() == 1,
        "expected one leaf, the wallet holds {}",
        leaves.len()
    );
    Ok(leaves[0].id.clone())
}

/// Sends `sats` from one scratch wallet to the other and waits for the claim.
/// A wallet that claims a leaf whose refund timelock has run down renews it
/// before reporting the claim, so the leaf is settled once this returns.
async fn send_between(from: &SparkWallet, to: &SparkWallet, sats: u64) -> Result<()> {
    // Subscribed before sending: the receiver can claim before `transfer` returns.
    let mut events = to.subscribe_events();
    from.transfer(sats, &to.get_spark_address()?, None).await?;
    wait_for_event(&mut events, 60, "TransferClaimed", |event| {
        Ok(matches!(event, WalletEvent::TransferClaimed(_)).then_some(event))
    })
    .await?;
    Ok(())
}

/// Makes a leaf of `sats`, has two scratch wallets renew it `renewals` times,
/// and sends it to `target`.
///
/// A sender signs the receiver's refund 100 blocks shorter each time, and the
/// receiver renews the leaf once that timelock is down to 100. A funded leaf is
/// the root of its own tree, so every renewal here is the zero timelock kind,
/// for which the operators put one split node above the leaf.
async fn renewed_leaf(
    fixtures: &Cluster,
    target: &str,
    sats: u64,
    renewals: u32,
) -> Result<RenewedLeaf> {
    ensure!(renewals >= 1, "renewals must be at least 1");
    eprintln!("Renewing a {sats} sat leaf {renewals} time(s) for {target}...");
    let address = SparkAddress::from_str(target)?;

    // Their own pair, so each holds this one leaf and the sdk has no other to
    // pick when a wallet sends its value.
    let (mut holder, mut other) = (
        scratch_wallet(fixtures, create_test_signer_alice()).await?,
        scratch_wallet(fixtures, create_test_signer_bob()).await?,
    );
    tokio::time::timeout(Duration::from_secs(120), deposit(&holder, fixtures, sats))
        .await
        .context("the scratch wallet never saw its deposit confirm")??;
    let leaf_id = only_leaf(&holder).await?;

    let mut transfers = 0;
    let pedigree = loop {
        // After a renewal the wallet holds a chain that stops at the new split
        // node, so it fetches the rest first.
        holder.fetch_missing_exit_chains().await?;
        let pedigree = holder
            .export_exit_state()
            .await?
            .pedigrees
            .into_iter()
            .find(|pedigree| pedigree.leaf.id == leaf_id)
            .with_context(|| format!("the scratch wallet no longer holds leaf {leaf_id}"))?;
        if pedigree.ancestors.len() >= renewals as usize {
            break pedigree;
        }
        ensure!(
            transfers < renewals * MAX_TRANSFERS_PER_RENEWAL,
            "the scratch wallets renewed leaf {leaf_id} only {} time(s) in {transfers} transfers",
            pedigree.ancestors.len()
        );
        send_between(&holder, &other, sats).await?;
        transfers += 1;
        std::mem::swap(&mut holder, &mut other);
    };
    eprintln!("Renewed leaf {leaf_id} {renewals} time(s) in {transfers} transfers");

    holder.transfer(sats, &address, None).await?;
    let mut ancestors = pedigree.ancestors;
    ancestors.reverse();
    Ok(RenewedLeaf {
        leaf: pedigree.leaf,
        ancestors,
    })
}

/// A connection to each operator's database. The cluster reads node statuses
/// there: the sdk folds every status it does not know into one before a wallet
/// sees it.
async fn operator_dbs(fixtures: &Cluster) -> Result<Vec<tokio_postgres::Client>> {
    let mut dbs = Vec::new();
    for operator in &fixtures.spark_so.operators {
        let (client, connection) =
            tokio_postgres::connect(&operator.postgres_connectionstring, tokio_postgres::NoTls)
                .await?;
        tokio::spawn(connection);
        dbs.push(client);
    }
    Ok(dbs)
}

/// The status the operators give a node, or `None` while they disagree. Each
/// operator follows the chain on its own, so they differ for a moment after a
/// block.
async fn node_status(dbs: &[tokio_postgres::Client], node: &TreeNodeId) -> Result<Option<String>> {
    let mut statuses = Vec::new();
    for db in dbs {
        let row = db
            .query_one(
                "SELECT status::text FROM tree_nodes WHERE id::text = $1",
                &[&node.to_string()],
            )
            .await?;
        statuses.push(row.get::<_, String>(0));
    }
    let agreed = statuses.windows(2).all(|pair| pair[0] == pair[1]);
    Ok(statuses.pop().filter(|_| agreed))
}

async fn await_node_status(
    dbs: &[tokio_postgres::Client],
    node: &TreeNodeId,
    want: &str,
) -> Result<()> {
    for _ in 0..60 {
        if node_status(dbs, node).await?.as_deref() == Some(want) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    bail!("the operators never marked node {node} {want}")
}

/// Waits until bitcoind has `txid`, in its mempool or in a block.
async fn await_transaction(fixtures: &Cluster, txid: &Txid) -> Result<()> {
    for _ in 0..120 {
        if fixtures.bitcoind.get_transaction(txid).await.is_ok() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    bail!("bitcoind never saw transaction {txid}")
}

impl RenewedLeaf {
    fn root(&self) -> Result<&TreeNode> {
        self.ancestors
            .first()
            .context("the leaf has no split node above it")
    }

    /// The root's child. Its direct transaction is the one the watchtower
    /// publishes once the root has been on-chain long enough.
    fn swept(&self) -> &TreeNode {
        self.ancestors.get(1).unwrap_or(&self.leaf)
    }

    fn sweep(&self) -> Result<&Transaction> {
        let swept = self.swept();
        swept
            .direct_tx
            .as_ref()
            .with_context(|| format!("node {} has no direct transaction", swept.id))
    }

    /// Blocks the root has to be on-chain before the sweep is valid.
    fn timelock(&self) -> Result<u32> {
        csv_timelock(self.sweep()?).with_context(|| {
            format!(
                "node {} has a direct transaction without a timelock",
                self.swept().id
            )
        })
    }
}

/// Confirms the root of a renewed leaf's tree and publishes nothing below it,
/// the way anyone who ever held the leaf can.
///
/// The operators then mark every node below the root PARENT_EXITED. The wallet
/// can no longer send the leaf, and has until the watchtower acts to exit it.
async fn parent_exit(
    fixtures: &Cluster,
    dbs: &[tokio_postgres::Client],
    renewed: &RenewedLeaf,
) -> Result<()> {
    let leaf_id = &renewed.leaf.id;
    match node_status(dbs, leaf_id).await?.as_deref() {
        Some("AVAILABLE") => {}
        Some("TRANSFER_LOCKED") => bail!(
            "The wallet has not claimed leaf {leaf_id}. Open the app, wait for the balance, then run this again."
        ),
        status => bail!(
            "Leaf {leaf_id} is {}. The scenario needs a leaf the wallet holds and nobody has exited.",
            status.unwrap_or("between statuses")
        ),
    }
    let root = renewed.root()?;

    // The operators sign node transactions without a fee, so the cluster adds a
    // child that pays for both.
    let coin = fund_p2tr_utxo(&fixtures.bitcoind, Amount::from_sat(ROOT_FEE_COIN_SATS)).await?;
    let child = build_cpfp_child(
        &root.node_tx,
        &[CpfpInput {
            outpoint: coin.outpoint,
            witness_utxo: coin.witness_utxo.clone(),
            signed_input_weight: p2tr_key_path_input_weight().to_wu(),
        }],
        ROOT_FEE_RATE_SAT_PER_KW,
    )?;
    let child = sign_cpfp_psbt_p2tr(&child.psbt, &coin.secret_key)?;
    let submitted = fixtures
        .bitcoind
        .submit_package(&[&root.node_tx, &child])
        .await?;
    ensure!(
        submitted["package_msg"] == "success",
        "bitcoind refused the root's package: {submitted}"
    );
    fixtures.bitcoind.generate_filler_blocks(1).await?;
    eprintln!(
        "Leaf {leaf_id}: root {} confirmed",
        root.node_tx.compute_txid()
    );
    await_node_status(dbs, leaf_id, "PARENT_EXITED").await
}

/// Has the watchtower cut off a renewed leaf, exiting the leaf's parent first
/// unless `parent_exit` already has.
///
/// The root's child has a direct transaction for the output its node transaction
/// needs, valid once the root has been on-chain for 50 blocks. The operators'
/// watchtower publishes it when those blocks have passed. The operators then
/// mark that child ON_CHAIN and every node below it WATCHTOWER_EXITED: nobody
/// can confirm their transactions any more.
///
/// A leaf renewed once is that child itself, so it ends ON_CHAIN. Only a leaf
/// renewed twice or more ends WATCHTOWER_EXITED.
async fn watchtower_exit(
    fixtures: &Cluster,
    dbs: &[tokio_postgres::Client],
    renewed: &RenewedLeaf,
) -> Result<()> {
    let leaf_id = &renewed.leaf.id;
    if node_status(dbs, leaf_id).await?.as_deref() != Some("PARENT_EXITED") {
        parent_exit(fixtures, dbs, renewed).await?;
    }
    let swept = renewed.swept();
    ensure!(
        swept.id == *leaf_id || node_status(dbs, &swept.id).await?.as_deref() != Some("ON_CHAIN"),
        "The wallet confirmed node {} itself, so the watchtower has nothing to publish for it.",
        swept.id
    );
    let (root_txid, sweep_txid) = (
        renewed.root()?.node_tx.compute_txid(),
        renewed.sweep()?.compute_txid(),
    );

    // The watchtower acts once the root has one more confirmation than the
    // timelock.
    let root: Value = fixtures
        .bitcoind
        .rpc(
            "getrawtransaction",
            &[json!(root_txid.to_string()), json!(1)],
        )
        .await?;
    let confirmations = root["confirmations"]
        .as_u64()
        .with_context(|| format!("the root {root_txid} is not on-chain"))?;
    let blocks = (u64::from(renewed.timelock()?) + 1).saturating_sub(confirmations);
    eprintln!("Leaf {leaf_id}: mining {blocks} blocks to pass the watchtower's timelock");
    if blocks > 0 {
        fixtures.bitcoind.generate_filler_blocks(blocks).await?;
    }

    await_transaction(fixtures, &sweep_txid)
        .await
        .context("the watchtower did not publish the direct transaction")?;
    fixtures.bitcoind.generate_filler_blocks(1).await?;
    let confirmed: Value = fixtures
        .bitcoind
        .rpc(
            "getrawtransaction",
            &[json!(sweep_txid.to_string()), json!(1)],
        )
        .await?;
    ensure!(
        confirmed["confirmations"].as_u64() >= Some(1),
        "bitcoind did not confirm the watchtower's transaction {sweep_txid}"
    );
    eprintln!("Leaf {leaf_id}: watchtower transaction {sweep_txid} confirmed");

    let want = if swept.id == *leaf_id {
        "ON_CHAIN"
    } else {
        "WATCHTOWER_EXITED"
    };
    await_node_status(dbs, leaf_id, want).await
}

/// What a scenario command prints about a renewed leaf: the statuses the
/// operators give its tree, and the transactions those statuses follow from.
async fn leaf_report(dbs: &[tokio_postgres::Client], renewed: &RenewedLeaf) -> Result<Value> {
    let mut nodes = Vec::new();
    for node in renewed.ancestors.iter().chain([&renewed.leaf]) {
        nodes.push(json!({
            "id": node.id.to_string(),
            "status": node_status(dbs, &node.id).await?,
        }));
    }
    Ok(json!({
        "leaf": renewed.leaf.id.to_string(),
        "status": node_status(dbs, &renewed.leaf.id).await?,
        "rootTxid": renewed.root()?.node_tx.compute_txid().to_string(),
        "watchtowerTxid": renewed.sweep()?.compute_txid().to_string(),
        "watchtowerTimelock": renewed.timelock()?,
        "nodes": nodes,
    }))
}

/// Enough of a query-string decode for the one value that carries spaces.
fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match (bytes[i], bytes.get(i + 1), bytes.get(i + 2)) {
            (b'%', Some(hi), Some(lo)) => {
                match u8::from_str_radix(&format!("{}{}", *hi as char, *lo as char), 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            _ => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Answers one `GET` request. Bare enough to need no http server: the only
/// client is a test runner on this machine.
///
/// - `/fund?sats=&count=&address=|mnemonic=`
/// - `/renewed-leaf?sats=&renewals=&address=|mnemonic=`
/// - `/parent-exit?leaf=` and `/watchtower-exit?leaf=`, which default to the
///   leaf made last
async fn serve(
    mut stream: tokio::net::TcpStream,
    funder: &SparkWallet,
    fixtures: &Cluster,
    default_target: &str,
    default_sats: u64,
    renewed_leaves: &mut Vec<RenewedLeaf>,
) -> Result<()> {
    let mut buf = [0u8; 2048];
    let read = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..read]);
    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();

    let param = |key: &str| -> Option<String> {
        path.split_once('?')?
            .1
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
    };
    // A phrase is the useful form for a test runner: it opens the wallet
    // with the same one, and a fresh phrase per run is a wallet with no
    // leaves left over from the last.
    let target = || match param("mnemonic") {
        Some(phrase) => spark_address_of(&percent_decode(&phrase)),
        None => Ok(param("address").unwrap_or_else(|| default_target.to_string())),
    };

    let answer: Result<Value> = async {
        if path.starts_with("/fund") {
            let sats: u64 = param("sats").map_or(Ok(default_sats), |v| v.parse())?;
            let count: u32 = param("count").map_or(Ok(1), |v| v.parse())?;
            fund(funder, fixtures, &target()?, sats, count).await?;
            Ok(json!({ "funded": count, "sats": sats }))
        } else if path.starts_with("/renewed-leaf") {
            let sats: u64 = param("sats").map_or(Ok(default_sats), |v| v.parse())?;
            let renewals: u32 = param("renewals").map_or(Ok(2), |v| v.parse())?;
            let renewed = renewed_leaf(fixtures, &target()?, sats, renewals).await?;
            let leaf = renewed.leaf.id.to_string();
            renewed_leaves.push(renewed);
            Ok(json!({ "leaf": leaf, "sats": sats, "renewals": renewals }))
        } else if path.starts_with("/parent-exit") || path.starts_with("/watchtower-exit") {
            let renewed = match param("leaf") {
                Some(id) => renewed_leaves
                    .iter()
                    .find(|renewed| renewed.leaf.id.to_string() == id),
                None => renewed_leaves.last(),
            }
            .context("No such renewed leaf. Make one first: npm run regtest:renewed-leaf")?;
            let dbs = operator_dbs(fixtures).await?;
            if path.starts_with("/parent-exit") {
                parent_exit(fixtures, &dbs, renewed).await?;
            } else {
                watchtower_exit(fixtures, &dbs, renewed).await?;
            }
            leaf_report(&dbs, renewed).await
        } else {
            Ok(json!({ "ok": true }))
        }
    }
    .await;
    let body = answer
        .unwrap_or_else(|e| json!({ "error": format!("{e:#}") }))
        .to_string();

    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}
