import json
import time
import sys

def can_finish(clues, current):
    n = len(current)
    m = len(clues)
    min_needed = [0] * (m + 1)
    for i in range(m - 1, -1, -1):
        min_needed[i] = min_needed[i + 1] + clues[i] + (1 if i + 1 < m else 0)
    memo = {}
    def helper(ci, pos):
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
        if current[pos] != 1:
            if helper(ci, pos + 1):
                ans = True
        if not ans:
            sz = clues[ci]
            if pos + sz <= n:
                can_block = True
                for p in range(pos, pos + sz):
                    if current[p] == 0:
                        can_block = False; break
                if can_block:
                    if ci == m - 1:
                        if helper(ci + 1, pos + sz):
                            ans = True
                    else:
                        if pos + sz < n and current[pos + sz] != 1:
                            if helper(ci + 1, pos + sz + 1):
                                ans = True
        memo[key] = ans
        return ans
    return helper(0, 0)

def deduce_line(clues, current):
    if not can_finish(clues, current):
        return None, 0
    n = len(current)
    new_line = list(current)
    changes = 0
    for i in range(n):
        if current[i] is None:
            current[i] = 1
            ok1 = can_finish(clues, current)
            current[i] = 0
            ok0 = can_finish(clues, current)
            current[i] = None
            if ok1 and not ok0:
                new_line[i] = 1
                changes += 1
            elif ok0 and not ok1:
                new_line[i] = 0
                changes += 1
            elif not ok1 and not ok0:
                return None, 0
    return new_line, changes

def solve_board(board, board_idx=0):
    w = board["width"]
    h = board["height"]
    rows = board["rows"]
    cols = board["cols"]
    
    grid = [[None for _ in range(w)] for _ in range(h)]
    
    def propagate(g):
        changed_rows = set(range(h))
        changed_cols = set(range(w))
        while changed_rows or changed_cols:
            r_list = list(changed_rows)
            changed_rows.clear()
            for r in r_list:
                res, ch = deduce_line(rows[r], g[r])
                if res is None:
                    return False
                if ch > 0:
                    for c in range(w):
                        if g[r][c] != res[c]:
                            g[r][c] = res[c]
                            changed_cols.add(c)
                            
            c_list = list(changed_cols)
            changed_cols.clear()
            for c in c_list:
                col_cells = [g[r][c] for r in range(h)]
                res, ch = deduce_line(cols[c], col_cells)
                if res is None:
                    return False
                if ch > 0:
                    for r in range(h):
                        if g[r][c] != res[r]:
                            g[r][c] = res[r]
                            changed_rows.add(r)
        return True

    print(f"Propagating initial grid for Board {board_idx+1}...")
    if not propagate(grid):
        raise ValueError("Initial propagation failed!")
        
    unknowns = sum(1 for r in range(h) for c in range(w) if grid[r][c] is None)
    print(f"After initial propagation: unknowns = {unknowns}/{w*h}")
    if unknowns == 0:
        return grid
        
    # DFS branching
    def dfs(g):
        unknowns = sum(1 for r in range(h) for c in range(w) if g[r][c] is None)
        if unknowns == 0:
            return g
            
        # choose cell with most constraints / adjacent filled
        best_cell = None
        for r in range(h):
            for c in range(w):
                if g[r][c] is None:
                    best_cell = (r, c)
                    break
            if best_cell:
                break
                
        r, c = best_cell
        for guess in [1, 0]:
            g_copy = [list(row) for row in g]
            g_copy[r][c] = guess
            # propagate changes from r and c
            ch_rows = set([r])
            ch_cols = set([c])
            valid = True
            while ch_rows or ch_cols:
                r_list = list(ch_rows); ch_rows.clear()
                for ri in r_list:
                    res, ch = deduce_line(rows[ri], g_copy[ri])
                    if res is None: valid = False; break
                    if ch > 0:
                        for ci in range(w):
                            if g_copy[ri][ci] != res[ci]:
                                g_copy[ri][ci] = res[ci]
                                ch_cols.add(ci)
                if not valid: break
                c_list = list(ch_cols); ch_cols.clear()
                for ci in c_list:
                    col_cells = [g_copy[ri][ci] for ri in range(h)]
                    res, ch = deduce_line(cols[ci], col_cells)
                    if res is None: valid = False; break
                    if ch > 0:
                        for ri in range(h):
                            if g_copy[ri][ci] != res[ri]:
                                g_copy[ri][ci] = res[ri]
                                ch_rows.add(ri)
                if not valid: break
                
            if valid:
                ans = dfs(g_copy)
                if ans is not None:
                    return ans
        return None

    return dfs(grid)

with open("challenge.json") as f:
    challenge = json.load(f)

solved_boards = []
for idx, board in enumerate(challenge["boards"]):
    t0 = time.time()
    sol = solve_board(board, idx)
    print(f"Board {idx+1} finished in {time.time()-t0:.2f}s")
    bin_rows = ["".join(str(cell) for cell in row) for row in sol]
    solved_boards.append(bin_rows)

out = {
    "challengeId": challenge["challengeId"],
    "encoding": "bin",
    "boards": solved_boards
}

with open("answer.json", "w") as f:
    json.dump(out, f)
print("\nSuccess! answer.json generated.")
