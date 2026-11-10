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
from ortools.sat.python import cp_model

ME = "0xCF909F35B2aC8Ad7c36f30B1574263b3A49368a3"
TOKEN = "eyJ2IjozLCJhZGRyZXNzIjoiMHhjZjkwOWYzNWIyYWM4YWQ3YzM2ZjMwYjE1NzQyNjNiM2E0OTM2OGEzIiwiZXhwIjoxNzkzMzA5NTc2fQ.1BeAHucXkIwNvlmPnr_IlwfBozxH7cAjW7uP0BcQk_I"
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
    trans = []
    trans.append((0, 0, 0))
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

def solve_board_cpsat(board, board_idx=0):
    w = board["width"]
    h = board["height"]
    rows = board["rows"]
    cols = board["cols"]

    model = cp_model.CpModel()
    grid = [[model.NewBoolVar(f"x_{r}_{c}") for c in range(w)] for r in range(h)]

    for r in range(h):
        if len(rows[r]) == 0:
            for c in range(w):
                model.Add(grid[r][c] == 0)
        else:
            st, accept, trans = build_automaton(rows[r])
            model.AddAutomaton([grid[r][c] for c in range(w)], st, accept, trans)

    for c in range(w):
        if len(cols[c]) == 0:
            for r in range(h):
                model.Add(grid[r][c] == 0)
        else:
            st, accept, trans = build_automaton(cols[c])
            model.AddAutomaton([grid[r][c] for r in range(h)], st, accept, trans)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 4 # Use all 4 CPU cores
    solver.parameters.max_time_in_seconds = 180.0
    
    print(f"\n--- Solving Board {board_idx+1} ({w}x{h}) using 4 CPU cores ---", flush=True)
    t0 = time.time()
    status = solver.Solve(model)
    elapsed = time.time() - t0
    print(f"Board {board_idx+1} status: {solver.StatusName(status)} in {elapsed:.2f}s", flush=True)
    
    if status != cp_model.OPTIMAL and status != cp_model.FEASIBLE:
        raise ValueError(f"Board {board_idx+1} failed to solve: {solver.StatusName(status)}")

    res = []
    for r in range(h):
        row_str = "".join(str(solver.Value(grid[r][c])) for c in range(w))
        res.append(row_str)
        
    def get_runs(s):
        runs = []
        cur = 0
        for ch in s:
            if ch == "1": cur += 1
            elif cur > 0: runs.append(cur); cur = 0
        if cur > 0: runs.append(cur)
        return runs
        
    for r in range(h):
        act = get_runs(res[r])
        assert act == rows[r], f"Row {r} verification failed! {act} != {rows[r]}"
    for c in range(w):
        act = get_runs("".join(res[r][c] for r in range(h)))
        assert act == cols[c], f"Col {c} verification failed! {act} != {cols[c]}"
        
    print(f"Board {board_idx+1} verified 100% correct!", flush=True)
    return res

def main():
    print("=== SOLVD AUTOMATED MINT BOT (WALLET 1: bys.ai) ===", flush=True)
    
    # 1. Request Challenge directly
    print("Requesting challenge from solvd.fun...", flush=True)
    challenge = api_call("/challenge/request", method="POST", data={})
    
    if "error" in challenge:
        print("Challenge notice:", challenge)
        if challenge.get("retryAfter"):
            print(f"Waiting retryAfter {challenge['retryAfter']}s...", flush=True)
            time.sleep(challenge["retryAfter"] + 1)
            challenge = api_call("/challenge/request", method="POST", data={})
            
    challenge_id = challenge.get("challengeId")
    boards = challenge.get("boards", [])
    print(f"Challenge received! ID: {challenge_id}, Boards: {len(boards)}, timeLimit: {challenge.get('timeLimitSec')}s", flush=True)
    with open("current_challenge.json", "w") as f:
        json.dump(challenge, f)

    # 2. Solve All Boards
    solved_boards = []
    for idx, b in enumerate(boards):
        ans = solve_board_cpsat(b, idx)
        solved_boards.append(ans)
        
    answer_payload = {
        "challengeId": challenge_id,
        "encoding": "bin",
        "boards": solved_boards
    }
    
    # 3. Submit Answer
    print("\nSubmitting answer to solvd.fun...", flush=True)
    submit_res = api_call("/challenge/submit", method="POST", data=answer_payload)
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
