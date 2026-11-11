import asyncio,json,pathlib,sys,edge_tts
out=pathlib.Path(sys.argv[1])
segments=[(0,4,'让你喜欢的角色，在桌面活过来。'),(4,10,'这是昔涟。现在，她住进了我的桌面。'),(10,17.2,'你工作，她也忙着自己的小日子。看书，写日记，安静地陪着你。'),(17.2,24.4,'轻轻摸摸头，拖到身边。她会用小表情，回应你的靠近。'),(24.4,31.6,'听歌，吃点零食，打会儿游戏。平凡的一天，也可以很可爱。'),(31.6,38.8,'她会四处走走，也会停下来，待在你身边。'),(38.8,46,'接入对话模型，就能聊聊今天。用熟悉的语气，记住你们的相处。'),(46,53.2,'累了，就一起歇一会儿。有时候，陪伴不需要说话。'),(53.2,61.2,'不止昔涟。你也能创建、导入喜欢的角色，在共享社区分享桌宠和生活插件。'),(61.2,67.2,'给 Demiurge 点一颗星，和我们一起，让喜欢的角色活过来。')]
async def main():
 for i,(start,end,text) in enumerate(segments):
  file=out/f'voice-{i}.mp3'
  if not file.exists(): await edge_tts.Communicate(text,'zh-CN-XiaoxiaoNeural',rate='+8%').save(str(file))
  print(i,text,flush=True)
 (out/'narration.json').write_text(json.dumps(segments,ensure_ascii=False,indent=2))
asyncio.run(main())
