# Builder Sorting Logic Diagnosis & Fix

## Current Logic (Failed)
We attempted to sort the list items by reconstructing the linked list using `previous_id` and `next_id` attributes from the `blocks` table.
- **Hypothesis**: The `sort` attribute is unreliable for newly inserted items, but the linked list structure (`previous_id` pointing to the preceding sibling) accurately reflects the visual order.
- **Implementation**:
    1.  Fetch all items.
    2.  Identify the "Head" (item with no `previous_id` or `previous_id` pointing to a block not in the current list).
    3.  Traverse `next_id` to build the list.
    4.  Fallback to DB order if the traversed count doesn't match the total count.

## Diagnosis of Failure
The logs show the order `1, 2, 3, 1.5, 2.5`, which matches the "append" order. This indicates the **fallback mechanism was triggered**, meaning the linked list reconstruction failed (incomplete chain).

### Possible Reasons for Chain Break
1.  **Multiple Heads / Fragments**: The DB might contain fragmented chains if sync/indexing is lagging.
2.  **Ghost Nodes**: `previous_id` might point to a block that was deleted or moved, making `map.has(previous_id)` false when it shouldn't be (or vice versa).
3.  **Type Mismatch**: String vs null handling for IDs.

## Corrected Strategy
We need a more robust sorting algorithm that handles potentially imperfect chains or correctly interprets the `sort` attribute if available.

However, since `sort` proved unreliable, we must fix the Linked List traversal.

**Improved Linked List Logic:**
1.  **Strict Head Detection**: Find the item whose `previous_id` is *empty* or *null*. This is the absolute start of the list.
    *   *Correction*: If the list is a sub-list, the first item's `previous_id` is NOT empty. It points to the parent? No, `previous_id` points to *sibling*. For the first item in a list, `previous_id` is empty (or points to nothing in that sibling scope).
2.  **Map-based Reordering**:
    *   Create a `nextMap`: `previous_id` -> `id`. (This maps "Who follows X?").
    *   Find the item that *no one follows*? No.
    *   Find the item that *follows no one* (Head).
    *   Traverse using `nextMap`.

**Alternative: Sort by `sort` attribute but explicitly numeric?**
SiYuan `sort` is a number. `ORDER BY sort ASC` should work *if* SiYuan updates it.
If SiYuan hasn't updated `sort` for `1.5` to be between `1` and `2`, then `sort` is useless.

**Conclusion**: We must debug the `previous_id` / `next_id` values to understand why the chain appears broken. I will add debug logs to inspect the chain linkage.