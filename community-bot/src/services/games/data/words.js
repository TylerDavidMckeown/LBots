/**
 * Word lists. Unscramble words were picked to avoid common anagrams (e.g. "lemon/melon"),
 * so the intended answer is the only everyday word those letters make.
 */

export const WORDGUESS_WORDS = Object.freeze([
  'apple', 'beach', 'brain', 'chair', 'cloud', 'crown', 'dance', 'dream', 'earth', 'flame',
  'fruit', 'ghost', 'grape', 'heart', 'house', 'juice', 'knife', 'light', 'magic', 'money',
  'mouse', 'music', 'night', 'ocean', 'paint', 'party', 'piano', 'plant', 'pizza', 'queen',
  'river', 'robot', 'scarf', 'sheep', 'shirt', 'smile', 'snake', 'space', 'spoon', 'storm',
  'sugar', 'sword', 'table', 'tiger', 'toast', 'tower', 'train', 'water', 'whale', 'world',
  'zebra', 'honey', 'candy', 'eagle', 'frost', 'glove', 'jelly', 'lucky', 'maple', 'olive',
  'pearl', 'quest', 'radio', 'salad', 'tulip', 'voice', 'wagon', 'yacht', 'blaze', 'cabin',
]);

export const SCRAMBLE_WORDS = Object.freeze({
  easy: Object.freeze([
    'frog', 'cake', 'fish', 'tree', 'gold', 'milk', 'book', 'king', 'duck', 'bell',
    'jump', 'corn', 'kite', 'sock', 'hand', 'desk', 'drum', 'wind', 'hill', 'panda',
    'tiger', 'jelly', 'zebra', 'piano', 'candy', 'plant', 'river', 'robot',
  ]),
  medium: Object.freeze([
    'rocket', 'jungle', 'pirate', 'wizard', 'dragon', 'guitar', 'button', 'rabbit', 'monkey', 'pencil',
    'window', 'island', 'bridge', 'pickle', 'pepper', 'dolphin', 'penguin', 'blanket', 'rainbow', 'library',
    'cabbage', 'volcano', 'chicken', 'hamster',
  ]),
  hard: Object.freeze([
    'elephant', 'treasure', 'mountain', 'sandwich', 'umbrella', 'dinosaur', 'keyboard', 'astronaut', 'adventure', 'chocolate',
    'butterfly', 'telescope', 'hurricane', 'kangaroo', 'crocodile', 'waterfall', 'pineapple', 'notebook', 'firework', 'lighthouse',
    'snowflake', 'submarine', 'strawberry', 'watermelon',
  ]),
});
