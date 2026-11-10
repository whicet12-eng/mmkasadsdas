import subprocess
import sys

try:
    out = subprocess.check_output(["node", "/workspaces/mmkasadsdas/check_multicall.cjs"]).decode()
    print(out)
except Exception as e:
    print(f'{{"error": "{str(e)}"}}')
