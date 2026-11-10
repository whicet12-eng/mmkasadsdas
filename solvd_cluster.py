import socket

# Force IPv4 across all Python networking in this container
orig_getaddrinfo = socket.getaddrinfo
def getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = getaddrinfo_ipv4

import json
import time
import urllib.request
import subprocess
import concurrent.futures
from ortools.sat.python import cp_model

ME = "0xd59878Bc7D16e2A9D777256def9239E4441848A3"
TOKEN = "eyJ2IjozLCJhZGRyZXNzIjoiMHhkNTk4NzhiYzdkMTZlMmE5ZDc3NzI1NmRlZjkyMzllNDQ0MTg0OGEzIiwiZXhwIjoxNzkzMzEwNjM0fQ.Gt_ehGVAy9nKM0y6QZ7XmS8P5iZwtb4f2wZa2EKb2rs"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def api_call(endpoint, method="GET", data=None):
    url = f"https://api.solvd.fun/v3{endpoint}"
    headers = {
        "User-Agent": UA,
        "Authorization": f"Bearer {TOKEN}",
        "Origin": "https://solvd.fun",
        "Referer": "https://solvd.fun/"
    }
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
        
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def build_automaton(clues):
    curr = 0
    trans = [(0, 0, 0)]
    for i, sz in enumerate(clues):
        start_block = curr
        trans.append((start_block, 1, curr + 1))
        for k in range(1, sz):
            trans.append((curr + k, 1, curr + k + 1))
        curr = curr + sz
        if i < len(clues) - 1:
            gap = curr + 1
            trans.append((curr, 0, gap))
            curr = gap
            trans.append((curr, 0, curr))
        else:
            trans.append((curr, 0, curr))
    return 0, [curr], trans

def solve_board_local(board, board_idx=0):
    w = board["width"]
    h = board["height"]
    rows = board["rows"]
    cols = board["cols"]

    model = cp_model.CpModel()
    grid = [[model.NewBoolVar(f"x_{r}_{c}") for c in range(w)] for r in range(h)]

    for r in range(h):
        if len(rows[r]) == 0:
            for c in range(w): model.Add(grid[r][c] == 0)
        else:
            st, accept, trans = build_automaton(rows[r])
            model.AddAutomaton([grid[r][c] for c in range(w)], st, accept, trans)

    for c in range(w):
        if len(cols[c]) == 0:
            for r in range(h): model.Add(grid[r][c] == 0)
        else:
            st, accept, trans = build_automaton(cols[c])
            model.AddAutomaton([grid[r][c] for r in range(h)], st, accept, trans)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 2
    solver.parameters.max_time_in_seconds = 280.0
    solver.parameters.search_branching = cp_model.PORTFOLIO_WITH_QUICK_RESTART_SEARCH

    print(f"[Node 1] Solving Board {board_idx+1} ({w}x{h})...", flush=True)
    t0 = time.time()
    status = solver.Solve(model)
    elapsed = time.time() - t0
    print(f"[Node 1] Board {board_idx+1} status: {solver.StatusName(status)} in {elapsed:.2f}s", flush=True)

    if status != cp_model.OPTIMAL and status != cp_model.FEASIBLE:
        raise ValueError(f"Board {board_idx+1} failed: {solver.StatusName(status)}")

    res = []
    for r in range(h):
        res.append("".join(str(solver.Value(grid[r][c])) for c in range(w)))
    return board_idx, res

def solve_board_remote(board, board_idx=0):
    board_json = json.dumps(board)
    py_script = f"""
import json, time
from ortools.sat.python import cp_model

board = json.loads({repr(board_json)})
w = board["width"]
h = board["height"]
rows = board["rows"]
cols = board["cols"]

def build_automaton(clues):
    curr = 0
    trans = [(0, 0, 0)]
    for i, sz in enumerate(clues):
        start_block = curr
        trans.append((start_block, 1, curr + 1))
        for k in range(1, sz):
            trans.append((curr + k, 1, curr + k + 1))
        curr = curr + sz
        if i < len(clues) - 1:
            gap = curr + 1
            trans.append((curr, 0, gap))
            curr = gap
            trans.append((curr, 0, curr))
        else:
            trans.append((curr, 0, curr))
    return 0, [curr], trans

model = cp_model.CpModel()
grid = [[model.NewBoolVar(f"x_{{r}}_{{c}}") for c in range(w)] for r in range(h)]

for r in range(h):
    if len(rows[r]) == 0:
        for c in range(w): model.Add(grid[r][c] == 0)
    else:
        st, accept, trans = build_automaton(rows[r])
        model.AddAutomaton([grid[r][c] for c in range(w)], st, accept, trans)

for c in range(w):
    if len(cols[c]) == 0:
        for r in range(h): model.Add(grid[r][c] == 0)
    else:
        st, accept, trans = build_automaton(cols[c])
        model.AddAutomaton([grid[r][c] for r in range(h)], st, accept, trans)

solver = cp_model.CpSolver()
solver.parameters.num_search_workers = 2
solver.parameters.max_time_in_seconds = 280.0
solver.parameters.search_branching = cp_model.PORTFOLIO_WITH_QUICK_RESTART_SEARCH

t0 = time.time()
status = solver.Solve(model)
if status != cp_model.OPTIMAL and status != cp_model.FEASIBLE:
    print(json.dumps({{"error": solver.StatusName(status)}}))
else:
    res = ["".join(str(solver.Value(grid[r][c])) for c in range(w)) for r in range(h)]
    print("RESULT_JSON:" + json.dumps(res))
"""
    print(f"[Node 2 (Remote)] Solving Board {board_idx+1} ({board['width']}x{board['height']})...", flush=True)
    t0 = time.time()
    ssh_cmd = ["gh", "codespace", "ssh", "-c", "repulsive-ghost-pgq5rv4jpwf6xgq", f"python3 -c {repr(py_script)}"]
    proc = subprocess.run(ssh_cmd, capture_output=True, text=True)
    elapsed = time.time() - t0
    
    out = proc.stdout
    if "RESULT_JSON:" not in out:
        print("[Node 2 Error]:", out, proc.stderr, flush=True)
        raise ValueError(f"Remote Board {board_idx+1} failed to solve: {out}")
        
    line = [l for l in out.splitlines() if l.startswith("RESULT_JSON:")][0]
    res = json.loads(line[len("RESULT_JSON:"):])
    print(f"[Node 2 (Remote)] Board {board_idx+1} solved in {elapsed:.2f}s!", flush=True)
    return board_idx, res

def verify_board(res, board, board_idx):
    rows = board["rows"]
    cols = board["cols"]
    w = board["width"]
    h = board["height"]
    def get_runs(s):
        runs = []
        cur = 0
        for ch in s:
            if ch == "1": cur += 1
            elif cur > 0: runs.append(cur); cur = 0
        if cur > 0: runs.append(cur)
        return runs
    for r in range(h):
        assert get_runs(res[r]) == rows[r], f"Row {r} failed on board {board_idx+1}"
    for c in range(w):
        assert get_runs("".join(res[r][c] for r in range(h))) == cols[c], f"Col {c} failed on board {board_idx+1}"
    print(f"Board {board_idx+1} verified 100% correct!", flush=True)

def main():
    print("=== SOLVD CLUSTER BOT (8 CPU CORES) FOR WALLET 2 (r3s.ai) ===", flush=True)
    
    # 1. Request Challenge
    print("Requesting challenge from solvd.fun...", flush=True)
    challenge = api_call("/challenge/request", method="POST", data={})
    if "error" in challenge:
        print("Challenge notice:", challenge)
        return
        
    challenge_id = challenge.get("challengeId")
    boards = challenge.get("boards", [])
    print(f"Challenge received! ID: {challenge_id}, Boards: {len(boards)}, timeLimit: {challenge.get('timeLimitSec')}s", flush=True)
    with open("current_challenge_cluster.json", "w") as f:
        json.dump(challenge, f)

    # 2. Parallel Distributed Solve across 8 CPU Cores
    # Boards 0, 1 on Local (4 CPU); Boards 2, 3 on Remote (4 CPU)
    t_start = time.time()
    solved = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = []
        # Assign boards: 0 & 1 to Local, 2 & 3 to Remote
        if len(boards) >= 4:
            futures.append(executor.submit(solve_board_local, boards[0], 0))
            futures.append(executor.submit(solve_board_local, boards[1], 1))
            futures.append(executor.submit(solve_board_remote, boards[2], 2))
            futures.append(executor.submit(solve_board_remote, boards[3], 3))
        else:
            for i, b in enumerate(boards):
                if i % 2 == 0:
                    futures.append(executor.submit(solve_board_local, b, i))
                else:
                    futures.append(executor.submit(solve_board_remote, b, i))
                    
        for fut in concurrent.futures.as_completed(futures):
            b_idx, ans = fut.result()
            verify_board(ans, boards[b_idx], b_idx)
            solved[b_idx] = ans

    total_solve_time = time.time() - t_start
    print(f"\n🎉 ALL {len(boards)} BOARDS SOLVED IN {total_solve_time:.2f}s!", flush=True)
    
    sorted_boards = [solved[i] for i in range(len(boards))]
    payload = {
        "challengeId": challenge_id,
        "encoding": "bin",
        "boards": sorted_boards
    }
    
    # 3. Submit Answer
    print("\nSubmitting answer to solvd.fun...", flush=True)
    submit_res = api_call("/challenge/submit", method="POST", data=payload)
    print("Submit response:", json.dumps(submit_res, indent=2), flush=True)
    
    if not submit_res.get("ok"):
        print("Submission failed!", submit_res)
        return
        
    print("\n🎉 CHALLENGE SOLVED SUCCESSFULLY! Received MintAuth!", flush=True)
    tx = submit_res["tx"]
    
    # 4. Execute Mint via BAW
    preview_cmd = [
        "baw", "contract-call", "preview",
        "--binanceChainId", "56",
        "--from", ME,
        "--to", tx["to"],
        "--value", "0",
        "--inputData", tx["data"],
        "--json"
    ]
    print(f"Running preview: {' '.join(preview_cmd)}", flush=True)
    p_proc = subprocess.run(preview_cmd, capture_output=True, text=True)
    print("Preview out:", p_proc.stdout, flush=True)
    p_json = json.loads(p_proc.stdout)
    req_id = p_json["data"]["requestId"]
    
    print(f"Executing mint with requestId {req_id}...", flush=True)
    exec_cmd = ["baw", "contract-call", "execute", "--requestId", req_id, "--json"]
    e_proc = subprocess.run(exec_cmd, capture_output=True, text=True)
    print("Execute out:", e_proc.stdout, flush=True)
    e_json = json.loads(e_proc.stdout)
    tx_hash = e_json["data"].get("txHash")
    print(f"\n🚀 MINT TRANSACTION BROADCASTED ON BSC: {tx_hash}", flush=True)

if __name__ == "__main__":
    main()
