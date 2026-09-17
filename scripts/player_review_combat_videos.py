"""Preserve and extract actual source-video frames for motion QA before Uthana."""
import json,pathlib,subprocess,shutil,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/player-combat-revision'
for name in (sys.argv[1:] or ['guard','light','heavy','hit','roll']):
    result=json.loads((DOC/f'{name}-video-result.json').read_text())
    assert result['status']=='completed',name
    source=ROOT/result['saved'][0]['path']
    local=ROOT/f'assets/player-combat-revision/source-videos/{name}.mp4'
    if not local.exists():shutil.copy2(source,local)
    frames=DOC/(name+'-source-frames');frames.mkdir(exist_ok=True)
    subprocess.run(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-i',str(local),'-vf','fps=4,scale=480:-2','-frames:v','20',str(frames/'frame-%02d.png')],check=True)
    subprocess.run(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-framerate','4','-i',str(frames/'frame-%02d.png'),'-vf','tile=4x5:padding=4:margin=4:color=0x17191d','-frames:v','1',str(DOC/(name+'-source-contact-sheet.png'))],check=True)
    print(name,result['id'],local)
