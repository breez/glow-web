/**
 * Random name generator using color + animal pattern
 * Extracted from Misty Breez for Lightning Address usernames
 */

const COLORS = [
  "Salmon", "Blue", "Turquoise", "Orchid", "Purple", "Tomato", "Cyan", "Crimson",
  "Orange", "Lime", "Pink", "Green", "Red", "Yellow", "Azure", "Silver", "Magenta",
  "Olive", "Violet", "Rose", "Wine", "Mint", "Indigo", "Jade", "Coral"
] as const;

const ANIMALS = [
  "Bat", "Bear", "Boar", "Cat", "Chick", "Cow", "Deer", "Dog", "Eagle", "Elephant",
  "Fox", "Frog", "Hippo", "Hummingbird", "Koala", "Lion", "Monkey", "Mouse", "Owl",
  "Ox", "Panda", "Pig", "Rabbit", "Seagull", "Sheep", "Snake"
] as const;

/**
 * Generates a random name in the format "ColorAnimal" (e.g., "BlueFox")
 * Used for Lightning Address usernames and other display purposes
 */
export const generateRandomName = (): string => {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${color}${animal}`;
};
