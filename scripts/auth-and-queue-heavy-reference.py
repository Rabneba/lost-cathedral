"""Fresh approved production connection, then the one pending heavy source.
Never prints or copies credentials; generation script refuses duplicate job IDs.
"""
from pathlib import Path
import subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
subprocess.run(['npx','genex','auth','--force'],cwd=ROOT,check=True)
subprocess.run(['npx','genex','doctor'],cwd=ROOT,check=True)
subprocess.run([sys.executable,'scripts/player_queue_combat_videos.py','heavy-v2'],cwd=ROOT,check=True)
