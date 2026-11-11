import sys,pathlib,subprocess,json,re,math,wave,array
import imageio_ffmpeg
a=pathlib.Path(sys.argv[1]);music=pathlib.Path(sys.argv[2]);ff=imageio_ffmpeg.get_ffmpeg_exe();sr=48000;n=round(67.2*sr)
def decode(file,filters,channels=1):
 p=subprocess.run([ff,'-v','error','-i',str(file),'-af',filters,'-t','67.2','-ar',str(sr),'-ac',str(channels),'-f','s16le','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 x=array.array('h');x.frombytes(p.stdout);return x
def rms(x):return math.sqrt(sum(v*v for v in x)/max(1,len(x)))
segments=json.loads((a/'narration.json').read_text());voice=array.array('f',[0])*n;coverage=[False]*n;report=[]
for i,(start,end,text) in enumerate(segments):
 raw=decode(a/f'voice-{i}.mp3','anull');speed=max(1,len(raw)/sr/(end-start-.35));assert speed<1.35
 if speed>1:raw=decode(a/f'voice-{i}.mp3',f'atempo={speed}')
 gain=min(4100/max(1,rms(raw)),27000/max(1,max(abs(v) for v in raw)));offset=round((start+.12)*sr)
 for j,v in enumerate(raw):
  if offset+j<n:voice[offset+j]+=v*gain;coverage[offset+j]=True
 report.append({'scene':i,'start':start+.12,'actualEnd':(offset+len(raw))/sr,'speed':speed,'gain':gain,'text':text});assert (offset+len(raw))/sr<end
bg=decode(music,'atrim=start=12:duration=67.2,asetpts=PTS-STARTPTS',2);assert len(bg)>=n*2-100
bg.extend([0]*max(0,n*2-len(bg)));gain=1450/max(1,rms(bg));mixed=array.array('f',[0])*(n*2);duck=1.;peak=0
for i in range(n):
 target=.32 if coverage[i] else 1.;duck+=(target-duck)*(1-math.exp(-1/(sr*(.025 if target<duck else .4))))
 fade=min(1,i/(sr*1.5),(n-i)/(sr*3));b=gain*duck*max(0,fade)
 for c in (0,1):
  v=voice[i]+bg[2*i+c]*b;mixed[2*i+c]=v;peak=max(peak,abs(v))
scale=min(1,30000/max(1,peak));pcm=array.array('h',(round(v*scale) for v in mixed))
with wave.open(str(a/'soundtrack.wav'),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes(pcm.tobytes())
with wave.open(str(a/'voice-only.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes(array.array('h',(round(v*scale) for v in voice)).tobytes())
(a/'audio-report.json').write_text(json.dumps({'duration':67.2,'samplesPerChannel':n,'peakDbFS':20*math.log10(peak*scale/32768),'voice':'Microsoft zh-CN-XiaoxiaoNeural','music':'心忆 / Remembrance of the Heart — HOYO-MiX, 林一凡','musicExcerptStart':12,'ducking':True,'segments':report},ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False));print('Mixed 67.2 seconds; peak:',20*math.log10(peak*scale/32768))
