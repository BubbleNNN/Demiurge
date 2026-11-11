"""Bounded, music-only soundtrack. No narration or original PV audio is mixed."""
import sys,pathlib,subprocess,json,math,wave,array
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parents[2]
board=json.loads((root/'scripts/media/storyboard.json').read_text())
assert board['musicOnly'] and board['voice'] is None
a=pathlib.Path(sys.argv[1]);music=pathlib.Path(sys.argv[2]);ff=imageio_ffmpeg.get_ffmpeg_exe()
sr=48000;duration=board['duration'];n=round(duration*sr)
p=subprocess.run([ff,'-v','error','-ss','12','-i',str(music),'-t',str(duration),'-ar',str(sr),'-ac','2','-f','s16le','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=120)
bg=array.array('h');bg.frombytes(p.stdout);assert len(bg)>=n*2-100
bg.extend([0]*max(0,n*2-len(bg)));del bg[n*2:]
peak=max(abs(v) for v in bg);gain=min(1.5,27500/max(1,peak))
for i in range(n):
    fade=min(1,i/(sr*1.25),(n-i)/(sr*5.5));g=gain*max(0,fade)
    bg[i*2]=round(bg[i*2]*g);bg[i*2+1]=round(bg[i*2+1]*g)
with wave.open(str(a/'soundtrack.wav'),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes(bg.tobytes())
report={'duration':duration,'samplesPerChannel':n,'peakDbFS':20*math.log10(max(abs(v) for v in bg)/32768),'voice':None,'musicOnly':True,'originalPVAudio':False,'music':'心忆 / Remembrance of the Heart — HOYO-MiX, 林一凡','musicExcerptStart':12,'fadeInSeconds':1.25,'fadeOutSeconds':5.5}
(a/'audio-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
