"""Cut only the requested short excerpts from a supplied local official PV."""
import json, pathlib, subprocess, sys, tempfile
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parents[2]
board=json.loads((root/'scripts/media/storyboard.json').read_text())
source=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
out.mkdir(parents=True,exist_ok=True);ff=imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory(prefix='demiurge-opening-') as temp:
    temp=pathlib.Path(temp);cuts=[]
    for i,cut in enumerate(board['opening']['cuts']):
        target=temp/f'{i}.mp4';cuts.append(target)
        subprocess.run([ff,'-v','error','-ss',str(cut['start']),'-i',str(source),'-t',str(cut['duration']),'-an','-vf','fps=30,format=yuv420p','-c:v','libx264','-crf','16','-preset','fast','-y',str(target)],check=True,timeout=120)
    listing=temp/'cuts.txt';listing.write_text(''.join("file '"+str(p)+"'\n" for p in cuts))
    subprocess.run([ff,'-v','error','-f','concat','-safe','0','-i',str(listing),'-c','copy','-an','-y',str(out/'opening.mp4')],check=True,timeout=60)
(out/'opening-source.json').write_text(json.dumps(board['opening'],ensure_ascii=False,indent=2))
print('Prepared 7.5 seconds of official footage, original aspect ratio, no source audio.')
