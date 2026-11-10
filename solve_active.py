import socket

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
    solver.parameters.num_search_workers = 4
    solver.parameters.max_time_in_seconds = 300.0

    print(f"[Node 1 (Local)] Solving Board {board_idx+1} ({w}x{h})...", flush=True)
    t0 = time.time()
    status = solver.Solve(model)
    elapsed = time.time() - t0
    print(f"[Node 1 (Local)] Board {board_idx+1} finished: {solver.StatusName(status)} in {elapsed:.2f}s", flush=True)

    if status != cp_model.OPTIMAL and status != cp_model.FEASIBLE:
        raise ValueError(f"Board {board_idx+1} failed: {solver.StatusName(status)}")

    res = ["".join(str(solver.Value(grid[r][c])) for c in range(w)) for r in range(h)]
    return board_idx, res

def solve_board_remote(board, board_idx=0):
    # Save board to file, SCP/cat to repulsive-ghost, run solver_node.py
    with open(f"/tmp/board_{board_idx}.json", "w") as f:
        json.dump(board, f)
        
    print(f"[Node 2 (Remote)] Sending and solving Board {board_idx+1} on repulsive-ghost...", flush=True)
    t0 = time.time()
    
    # Upload board file
    board_str = json.dumps(board)
    upload_cmd = f"cat << 'EOF' > /tmp/board_{board_idx}.json\n{board_str}\nEOF\npython3 ~/solver_node.py {board_idx} /tmp/board_{board_idx}.json && cat /tmp/out_{board_idx}.json"
    
    proc = subprocess.run(["gh", "codespace", "ssh", "-c", "repulsive-ghost-pgq5rv4jpwf6xgq", upload_cmd], capture_output=True, text=True)
    elapsed = time.time() - t0
    
    out = proc.stdout
    if "SUCCESS_SAVED" not in out:
        print(f"[Node 2 (Remote)] Error on board {board_idx+1}:", out, proc.stderr, flush=True)
        raise ValueError(f"Remote solve failed: {out}")
        
    # Extract json from output
    lines = [l for l in out.splitlines() if l.startswith("[") and l.endswith("]")]
    if not lines:
        raise ValueError(f"Could not parse remote JSON output: {out}")
    res = json.loads(lines[-1])
    print(f"[Node 2 (Remote)] Board {board_idx+1} solved in {elapsed:.2f}s!", flush=True)
    return board_idx, res

def main():
    print("=== SOLVING ACTIVE CHALLENGE FOR WALLET 2 (r3s.ai) ===", flush=True)
    with open("current_challenge_cluster.json") as f:
        challenge = json.load(f)
        
    challenge_id = challenge["challengeId"]
    boards = challenge["boards"]
    print(f"Challenge ID: {challenge_id}, Boards: {len(boards)}, size: {boards[0]['width']}x{boards[0]['height']}", flush=True)
    
    # We solve: Board 0, 1 on Local; Board 2, 3 on Remote in PARALLEL
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        # Run Local worker sequentially (Board 0 then Board 1, using all 4 local cores)
        # Run Remote worker sequentially (Board 2 then Board 3, using all 4 remote cores)
        def run_local_pair():
            b0_idx, b0_res = solve_board_local(boards[0], 0)
            b1_idx, b1_res = solve_board_local(boards[1], 1)
            return [(b0_idx, b0_res), (b1_idx, b1_res)]
            
        def run_remote_pair():
            b2_idx, b2_res = solve_board_remote(boards[2], 2)
            b3_idx, b3_res = solve_board_remote(boards[3], 3)
            return [(b2_idx, b2_res), (b3_idx, b3_res)]
            
        f_local = executor.submit(run_local_pair)
        f_remote = executor.submit(run_remote_pair)
        
        for idx, res in f_local.result():
            results[idx] = res
        for idx, res in f_remote.result():
            results[idx] = res

    print("\n🎉 ALL 4 BOARDS SOLVED IN PARALLEL ACROSS BOTH NODES!", flush=True)
    sorted_boards = [results[i] for i in range(4)]
    
    payload = {
        "challengeId": challenge_id,
        "encoding": "bin",
        "boards": sorted_boards
    }
    
    print("\nSubmitting answer to solvd.fun...", flush=True)
    submit_res = api_call("/challenge/submit", method="POST", data=payload)
    print("Submit response:", json.dumps(submit_res, indent=2), flush=True)
    
    if not submit_res.get("ok"):
        print("Submission failed!", submit_res)
        return
        
    print("\n🎉 CHALLENGE SOLVED SUCCESSFULLY! Received MintAuth!", flush=True)
    tx = submit_res["tx"]
    
    preview_cmd = [
        "baw", "contract-call", "preview",
        "--binanceChainId", "56",
        "--from", ME,
        "--to", tx["to"],
        "--value", "0",
        "--inputData", tx["data"],
        "--json"
    ]
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
