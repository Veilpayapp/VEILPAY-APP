/**
 * Off-chain correctness oracle for the depth-20 incremental Merkle tree
 * consumed by the Withdraw circuit (`packages/circuits/withdraw.circom`)
 * and `VeilPool.sol`.
 *
 * The Withdraw circuit's `MerkleTreeChecker(20)` and `VeilPool`'s on-chain
 * incremental tree must produce identical roots when the same sequence of
 * commitment leaves is inserted; this helper is the reference implementation
 * both test suites compare against.
 *
 * Design notes:
 * - Tornado-style incremental tree: O(depth) Poseidon hashes per insert.
 * - Uses `circomlibjs.buildPoseidon()` so the hash function is byte-compatible
 *   with the BN254 Poseidon used inside the Circom circuit.
 * - Empty-tree leaf is `0n` (matches the design's `ZERO_VALUE`).
 * - `path(index)` returns the Merkle authentication path consumed by
 *   `MerkleTreeChecker`: `pathElements[i]` is the sibling at level `i` and
 *   `pathIndices[i]` is `(index >> i) & 1` — `0` when the leaf-side node is
 *   on the left at that level, `1` when it is on the right.
 *
 * Public input ordering: see design.md §Public input ordering contract.
 */

// `circomlibjs` does not ship TypeScript declarations as of v0.1.7.
// We rely on the runtime shape: `buildPoseidon` resolves to a callable
// `poseidon(inputs)` that also exposes `.F` for field-element conversion.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circomlibjs: { buildPoseidon: () => Promise<PoseidonFn> } = require('circomlibjs');

/** Default Tornado-style depth used by the Withdraw circuit. */
export const LEVELS = 20;

/** Empty-leaf zero value used to seed the precomputed `zeros[]` ladder. */
export const ZERO_VALUE: bigint = 0n;

/** A field element as returned by circomlibjs's Poseidon (montgomery bytes). */
type FieldElement = Uint8Array;

/** Minimal structural type for the BN254 field exposed by circomlibjs. */
interface Field {
  toObject(x: FieldElement): bigint;
  e(x: bigint | string | number): FieldElement;
}

/** Minimal structural type for the Poseidon function returned by buildPoseidon. */
interface PoseidonFn {
  (inputs: ReadonlyArray<bigint | number | string>): FieldElement;
  F: Field;
}

/** Inputs `MerkleTreeChecker` consumes: sibling at each level + side bit. */
export interface MerklePath {
  pathElements: bigint[];
  pathIndices: number[];
}

/**
 * Tornado-style incremental Merkle tree of depth `levels` (default 20) over
 * BN254 with circomlib's Poseidon as the compression function.
 *
 * Construction is synchronous once a built Poseidon is supplied. Use the
 * `createIncrementalMerkleTree()` factory below if you do not already have a
 * `Poseidon` instance.
 */
export class IncrementalMerkleTree {
  public readonly levels: number;

  /** `zeros[i]` is the root of an all-zero subtree of height `i`. */
  private readonly zeros: bigint[];

  /**
   * `filledSubtrees[i]` holds the most recent left-side hash at level `i`
   * needed to compute the next root in O(depth) — Tornado convention.
   */
  private readonly filledSubtrees: bigint[];

  /** Full tree, level-keyed. `nodes[0]` is the leaf row, `nodes[levels]` the root row. */
  private readonly nodes: Map<number, bigint>[];

  private readonly poseidon: PoseidonFn;
  private readonly F: Field;

  private currentRoot: bigint;
  private nextIndex = 0;

  constructor(poseidon: PoseidonFn, levels: number = LEVELS) {
    if (!Number.isInteger(levels) || levels <= 0) {
      throw new Error(`IncrementalMerkleTree: levels must be a positive integer (got ${levels})`);
    }

    this.levels = levels;
    this.poseidon = poseidon;
    this.F = poseidon.F;

    // Precompute zeros[0..levels]: zeros[0] = ZERO_VALUE,
    // zeros[i] = Poseidon(zeros[i-1], zeros[i-1]).
    this.zeros = new Array<bigint>(levels + 1);
    this.zeros[0] = ZERO_VALUE;
    for (let i = 1; i <= levels; i++) {
      this.zeros[i] = this.hashPair(this.zeros[i - 1], this.zeros[i - 1]);
    }

    // filledSubtrees seeded to the all-zero subtree at each level.
    this.filledSubtrees = new Array<bigint>(levels);
    for (let i = 0; i < levels; i++) {
      this.filledSubtrees[i] = this.zeros[i];
    }

    // Sparse node store; we only allocate nodes that have been touched.
    this.nodes = new Array(levels + 1).fill(null).map(() => new Map<number, bigint>());

    this.currentRoot = this.zeros[levels];
  }

  /**
   * Append `leaf` at the next free slot, recompute filledSubtrees, and
   * update the stored root. Throws once the tree has reached `2 ** levels`
   * leaves — same condition as `VeilPool.TreeFull`.
   */
  insert(leaf: bigint): void {
    if (this.nextIndex >= 2 ** this.levels) {
      throw new Error('IncrementalMerkleTree: tree is full');
    }

    let currentIndex = this.nextIndex;
    let currentHash = leaf;

    // Record the leaf row.
    this.nodes[0].set(currentIndex, leaf);

    for (let i = 0; i < this.levels; i++) {
      let left: bigint;
      let right: bigint;

      if ((currentIndex & 1) === 0) {
        // Leaf-side node is on the left at this level: sibling is the empty
        // subtree zero, and we cache this node into filledSubtrees so the
        // next odd-indexed insertion can pair against it.
        left = currentHash;
        right = this.zeros[i];
        this.filledSubtrees[i] = currentHash;
      } else {
        // Leaf-side node is on the right at this level: pair against the
        // most recent cached left-side hash.
        left = this.filledSubtrees[i];
        right = currentHash;
      }

      currentHash = this.hashPair(left, right);
      currentIndex >>= 1;
      this.nodes[i + 1].set(currentIndex, currentHash);
    }

    this.currentRoot = currentHash;
    this.nextIndex += 1;
  }

  /** Current Merkle root (matches what an on-chain incremental tree would store). */
  root(): bigint {
    return this.currentRoot;
  }

  /** Number of leaves inserted so far. */
  size(): number {
    return this.nextIndex;
  }

  /**
   * Authentication path for the leaf at `index`.
   *
   * `pathElements[i]` is the sibling hash needed at level `i`; siblings on
   * not-yet-populated subtree slots are filled with the precomputed zero at
   * that level so the path always resolves to the current root.
   *
   * `pathIndices[i] = (index >> i) & 1` — `0` when the leaf-side node is on
   * the left at level `i`, `1` when it is on the right. This is the bit
   * layout `circomlib`'s `MerkleTreeChecker` expects.
   */
  path(index: number): MerklePath {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`IncrementalMerkleTree: index must be a non-negative integer (got ${index})`);
    }
    if (index >= this.nextIndex) {
      throw new Error(
        `IncrementalMerkleTree: index ${index} out of bounds (size=${this.nextIndex})`,
      );
    }

    const pathElements: bigint[] = new Array(this.levels);
    const pathIndices: number[] = new Array(this.levels);

    let currentIndex = index;
    for (let i = 0; i < this.levels; i++) {
      const sideBit = currentIndex & 1;
      pathIndices[i] = sideBit;

      const siblingIndex = currentIndex ^ 1;
      const sibling = this.nodes[i].get(siblingIndex);
      pathElements[i] = sibling !== undefined ? sibling : this.zeros[i];

      currentIndex >>= 1;
    }

    return { pathElements, pathIndices };
  }

  /** Poseidon(left, right) → bigint, using the BN254-compatible hash. */
  private hashPair(left: bigint, right: bigint): bigint {
    return this.F.toObject(this.poseidon([left, right]));
  }
}

/**
 * Convenience factory: builds Poseidon and returns a ready-to-use tree.
 *
 * @example
 *   const tree = await createIncrementalMerkleTree();
 *   tree.insert(commitmentHash);
 *   const { pathElements, pathIndices } = tree.path(0);
 */
export async function createIncrementalMerkleTree(
  levels: number = LEVELS,
): Promise<IncrementalMerkleTree> {
  const poseidon = await circomlibjs.buildPoseidon();
  return new IncrementalMerkleTree(poseidon, levels);
}
