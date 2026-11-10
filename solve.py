import json
import time

def solve_line(clues, current):
    # current is a list/tuple of length n, values: None (unknown), 0, 1
    # clues is list of ints
    n = len(current)
    m = len(clues)
    
    # Memoized DP
    # dp(clue_idx, pos) returns bool: can we match clues[clue_idx:] starting at pos?
    memo = {}
    
    # Precompute suffix sums of clues + min spaces
    min_needed = [0] * (m + 1)
    for i in range(m - 1, -1, -1):
        min_needed[i] = min_needed[i + 1] + clues[i] + (1 if i + 1 < m else 0)
        
    def can_match(ci, pos):
        if ci == m:
            # All remaining must be 0 or None
            for p in range(pos, n):
                if current[p] == 1:
                    return False
            return True
            
        if pos + min_needed[ci] > n:
            return False
            
        state = (ci, pos)
        if state in memo:
            return memo[state]
            
        # Try putting 0 at pos (if allowed)
        res = False
        if current[pos] != 1:
            if can_match(ci, pos + 1):
                res = True
                
        # Try placing block clues[ci] starting at pos
        if not res or True: # we need full branch search for cell possibilities
            pass
        memo[state] = res
        return res

    # Actually, let's find all cells that can be 0 and all cells that can be 1
    # dp(ci, pos) -> set of (reachable states) or bitmasks
    # Since n=56 is small, let us do forward DP to find reachable (ci, pos) states,
    # then backward DP, and compute for each cell whether 0 or 1 is possible!
    
    # forward[pos][ci] = True if we can reach pos with ci clues placed so far
    # Also need to track if we just placed a block and must have a 0:
    # State: (pos, ci, state) where state: 0 (after space or at start), 1 (must be space after block)
    
    # Simpler:
    # A valid placement is a sequence of gap sizes: g_0, g_1, ..., g_m >= 0 (with g_1..g_{m-1} >= 1)
    # such that sum(g_i) + sum(clues) == n.
    
    # Let's do standard DP:
    # can_finish(ci, pos): can remaining clues be placed in current[pos:]?
    memo = {}
    def can_finish(ci, pos):
        if ci == m:
            for p in range(pos, n):
                if current[p] == 1:
                    return False
            return True
        if pos + min_needed[ci] > n:
            return False
        key = (ci, pos)
        if key in memo:
            return memo[key]
            
        ans = False
        # Option 1: cell pos is 0
        if current[pos] != 1:
            if can_finish(ci, pos + 1):
                ans = True
                
        # Option 2: place block clues[ci] at [pos, pos + clues[ci])
        sz = clues[ci]
        if pos + sz <= n:
            # check if cells [pos, pos+sz) can all be 1
            can_block = True
            for p in range(pos, pos + sz):
                if current[p] == 0:
                    can_block = False
                    break
            if can_block:
                if ci == m - 1:
                    if can_finish(ci + 1, pos + sz):
                        ans = True
                else:
                    # must have a separator 0 at pos + sz
                    if pos + sz < n and current[pos + sz] != 1:
                        if can_finish(ci + 1, pos + sz + 1):
                            ans = True
        memo[key] = ans
        return ans

    if not can_finish(0, 0):
        return None # Inconsistent!

    # Now find for each pos whether 0 is possible and whether 1 is possible
    # We can do this with forward reachability:
    # fwd_reach[pos][ci] = True if prefix [0, pos) can place ci blocks and leave pos ready for 0 or new block
    # Or simply:
    possible_1 = [False] * n
    possible_0 = [False] * n

    # Let reachable_transitions collect which (ci, pos) are used
    # Forward check:
    fwd_memo = {}
    def get_valid_placements(ci, pos):
        # yields or marks valid paths
        pass

    # Since n=56 and m <= 15, we can compute reachability matrix in O(m * n):
    # reachable_start[ci, pos] = True if prefix can lead to (ci, pos) AND can_finish(ci, pos) is True
    # Let valid_start[ci, pos] = is reachable from start and can finish
    # To find reachable from start:
    fwd = set([(0, 0)]) # (ci, pos)
    valid_configs = set()
    
    for pos in range(n):
        next_fwd = set()
        for ci, p in fwd:
            if p != pos:
                continue
            if not can_finish(ci, pos):
                continue
            valid_configs.add((ci, pos))
            # Option 1: pos is 0
            if current[pos] != 1:
                next_fwd.add((ci, pos + 1))
            # Option 2: block of clues[ci]
            if ci < m:
                sz = clues[ci]
                if pos + sz <= n and all(current[pos + k] != 0 for k in range(sz)):
                    if ci == m - 1:
                        if can_finish(ci + 1, pos + sz):
                            next_fwd.add((ci + 1, pos + sz))
                    else:
                        if pos + sz < n and current[pos + sz] != 1:
                            if can_finish(ci + 1, pos + sz + 1):
                                next_fwd.add((ci + 1, pos + sz + 1))
        fwd = next_fwd

    # Now check for each pos if 0 is possible and if 1 is possible
    for ci, pos in valid_configs:
        # If pos is 0:
        if current[pos] != 1 and can_finish(ci, pos + 1):
            possible_0[pos] = True
        # If block starts at pos:
        if ci < m:
            sz = clues[ci]
            if pos + sz <= n and all(current[pos + k] != 0 for k in range(sz)):
                end_ok = False
                if ci == m - 1:
                    end_ok = can_finish(ci + 1, pos + sz)
                else:
                    if pos + sz < n and current[pos + sz] != 1 and can_finish(ci + 1, pos + sz + 1):
                        end_ok = True
                if end_ok:
                    for k in range(sz):
                        possible_1[pos + k] = True
                    if ci < m - 1 and pos + sz < n:
                        possible_0[pos + sz] = True

    new_line = list(current)
    changes = 0
    for i in range(n):
        if new_line[i] is None:
            if possible_1[i] and not possible_0[i]:
                new_line[i] = 1
                changes += 1
            elif possible_0[i] and not possible_1[i]:
                new_line[i] = 0
                changes += 1
            elif not possible_0[i] and not possible_1[i]:
                return None # Contradiction!
    return new_line, changes

def solve_board(board):
    w = board["width"]
    h = board["height"]
    rows = board["rows"]
    cols = board["cols"]
    
    grid = [[None for _ in range(w)] for _ in range(h)]
    
    # Line solving loop
    iteration = 0
    while True:
        total_changes = 0
        iteration += 1
        # Solve rows
        for r in range(h):
            res = solve_line(rows[r], grid[r])
            if res is None:
                raise ValueError(f"Contradiction in row {r}")
            grid[r], ch = res
            total_changes += ch
            
        # Solve cols
        for c in range(w):
            col_cells = [grid[r][c] for r in range(h)]
            res = solve_line(cols[c], col_cells)
            if res is None:
                raise ValueError(f"Contradiction in col {c}")
            col_cells, ch = res
            for r in range(h):
                grid[r][c] = col_cells[r]
            total_changes += ch
            
        unknowns = sum(1 for r in range(h) for c in range(w) if grid[r][c] is None)
        print(f"Iter {iteration}: changes={total_changes}, unknowns={unknowns}/{w*h}")
        if unknowns == 0:
            print("Board fully solved by line deduction!")
            return grid
        if total_changes == 0:
            print(f"Line deduction stalled with {unknowns} unknowns. Need DFS branching.")
            break
            
    # If branching needed, simple DFS
    def dfs(g):
        # find cell with None
        best_cell = None
        for r in range(h):
            for c in range(w):
                if g[r][c] is None:
                    best_cell = (r, c)
                    break
            if best_cell:
                break
        if not best_cell:
            return g
            
        r, c = best_cell
        for guess in [1, 0]:
            import copy
            g_copy = [list(row) for row in g]
            g_copy[r][c] = guess
            # propagate
            valid = True
            while True:
                ch = 0
                for ri in range(h):
                    res = solve_line(rows[ri], g_copy[ri])
                    if res is None:
                        valid = False; break
                    g_copy[ri], c_cnt = res
                    ch += c_cnt
                if not valid: break
                for ci in range(w):
                    col_cells = [g_copy[ri][ci] for ri in range(h)]
                    res = solve_line(cols[ci], col_cells)
                    if res is None:
                        valid = False; break
                    col_cells, c_cnt = res
                    for ri in range(h):
                        g_copy[ri][ci] = col_cells[ri]
                    ch += c_cnt
                if not valid or ch == 0: break
                
            if valid:
                res = dfs(g_copy)
                if res is not None:
                    return res
        return None

    return dfs(grid)

with open("challenge.json") as f:
    challenge = json.load(f)

solved_boards = []
for idx, board in enumerate(challenge["boards"]):
    print(f"\n--- Solving Board {idx+1}/{len(challenge['boards'])} ---")
    t0 = time.time()
    sol = solve_board(board)
    print(f"Board {idx+1} solved in {time.time()-t0:.2f}s")
    # Convert to binary string rows
    bin_rows = ["".join(str(cell) for cell in row) for row in sol]
    solved_boards.append(bin_rows)

out = {
    "challengeId": challenge["challengeId"],
    "encoding": "bin",
    "boards": solved_boards
}

with open("answer.json", "w") as f:
    json.dump(out, f)
print("\nAll boards solved and saved to answer.json!")
