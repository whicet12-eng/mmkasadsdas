import json
import time
from pysat.solvers import Cadical153

def solve_nonogram(board):
    w = board["width"]
    h = board["height"]
    rows = board["rows"]
    cols = board["cols"]
    
    var_map = {}
    next_var = 1
    def get_var(name):
        nonlocal next_var
        if name not in var_map:
            var_map[name] = next_var
            next_var += 1
        return var_map[name]

    def cell(r, c):
        return get_var(f"x_{r}_{c}")

    solver = Cadical153()

    def build_dfa(clues):
        curr = 0
        trans = {}
        trans[(0, 0)] = 0
        for i, sz in enumerate(clues):
            start_block = curr
            trans[(start_block, 1)] = curr + 1
            for k in range(1, sz):
                trans[(curr + k, 1)] = curr + k + 1
            curr = curr + sz
            if i < len(clues) - 1:
                gap = curr + 1
                trans[(curr, 0)] = gap
                curr = gap
                trans[(curr, 0)] = curr
            else:
                trans[(curr, 0)] = curr
        accept = set([curr])
        num_states = curr + 1
        return num_states, 0, accept, trans

    def add_line_constraint(line_cells, clues, prefix):
        L = len(line_cells)
        if len(clues) == 0:
            for c in line_cells:
                solver.add_clause([-c])
            return
        num_states, start_st, accept, trans = build_dfa(clues)
        
        def S(t, s):
            return get_var(f"{prefix}_S_{t}_{s}")

        solver.add_clause([S(0, start_st)])
        for s in range(num_states):
            if s != start_st:
                solver.add_clause([-S(0, s)])

        solver.add_clause([S(L, s) for s in accept])

        # Step transitions
        for t in range(L):
            x = line_cells[t]
            for s in range(num_states):
                if (s, 0) not in trans:
                    solver.add_clause([-S(t, s), x])
                else:
                    solver.add_clause([-S(t, s), x, S(t+1, trans[(s,0)])])

                if (s, 1) not in trans:
                    solver.add_clause([-S(t, s), -x])
                else:
                    solver.add_clause([-S(t, s), -x, S(t+1, trans[(s,1)])])

            # Ensure at least one state per step:
            # solver.add_clause([S(t, s) for s in range(num_states)])
            # Actually not strictly necessary with forward implications + accept state,
            # but let's add backward constraints to prevent phantom states
            in_trans = {s: [] for s in range(num_states)}
            for (s_prev, sym), s_next in trans.items():
                in_trans[s_next].append((s_prev, sym))
            for s_next, preds in in_trans.items():
                if not preds:
                    solver.add_clause([-S(t+1, s_next)])
                else:
                    # S(t+1, s_next) => Or(S(t, s_prev) and (sym))
                    # CNF: for each state not in preds, or just:
                    # Not S(t+1, s_next) or Or(S(t, p) for p in preds)
                    solver.add_clause([-S(t+1, s_next)] + [S(t, p[0]) for p in preds])

    for r in range(h):
        line = [cell(r, c) for c in range(w)]
        add_line_constraint(line, rows[r], f"r{r}")

    for c in range(w):
        line = [cell(r, c) for c in range(h)]
        add_line_constraint(line, cols[c], f"c{c}")

    t0 = time.time()
    ok = solver.solve()
    if not ok:
        raise ValueError("Board unsatisfiable!")
        
    model = set(solver.get_model())
    grid = []
    for r in range(h):
        row_str = "".join("1" if cell(r, c) in model else "0" for c in range(w))
        grid.append(row_str)
        
    # VERIFY SOLUTION
    def get_runs(line_str):
        runs = []
        curr = 0
        for ch in line_str:
            if ch == "1":
                curr += 1
            else:
                if curr > 0:
                    runs.append(curr)
                    curr = 0
        if curr > 0:
            runs.append(curr)
        return runs

    for r in range(h):
        actual = get_runs(grid[r])
        expected = rows[r]
        assert actual == expected, f"Row {r} mismatch! expected {expected}, got {actual}"

    for c in range(w):
        col_str = "".join(grid[r][c] for r in range(h))
        actual = get_runs(col_str)
        expected = cols[c]
        assert actual == expected, f"Col {c} mismatch! expected {expected}, got {actual}"

    print(f"Verified board ({w}x{h}) in {time.time()-t0:.2f}s!")
    return grid

with open("challenge.json") as f:
    challenge = json.load(f)

solved_boards = []
for idx, board in enumerate(challenge["boards"]):
    print(f"\nSolving board {idx+1}/{len(challenge['boards'])}...")
    t0 = time.time()
    sol = solve_nonogram(board)
    solved_boards.append(sol)
    print(f"Board {idx+1} completely verified and solved in {time.time()-t0:.2f}s!")

out = {
    "challengeId": challenge["challengeId"],
    "encoding": "bin",
    "boards": solved_boards
}

with open("answer.json", "w") as f:
    json.dump(out, f)

print(f"\nAll {len(solved_boards)} boards verified and saved to answer.json!")
