'use strict';
const {parseHTML}=require('linkedom');
const {sourceUrl}=require('./sources.cjs');
const {referencePack,imageDigest}=require('./references.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const CHIBI=/q\s*版|表情|贴纸|貼紙|chibi|sticker|emote|emoji|sd\s*character/i;
function validateChibiResearch(value) {
  if(!value || !['found','fallback'].includes(value.status) || typeof value.checkedAt!=='string' || !Number.isFinite(Date.parse(value.checkedAt)) || typeof value.reason!=='string' || value.reason.length>600 || !Array.isArray(value.sources) || value.sources.length>6 || !Array.isArray(value.warnings) || value.warnings.length>8)throw Error('Q版参考记录无效。');
  return {status:value.status,checkedAt:value.checkedAt,reason:value.reason,sources:value.sources.map(s=>({title:String(s.title||'图片来源').slice(0,200),url:sourceUrl(s.url),...(s.imageUrl?{imageUrl:sourceUrl(s.imageUrl)}:{})})),warnings:value.warnings.map(w=>String(w).slice(0,300))};
}
function pageChibiImages(bytes,url,source={}) {
  const {document}=parseHTML(bytes.toString('utf8'));
  const title=document.querySelector('title')?.textContent || source.title || '';
  const pageIsChibi=CHIBI.test(title+' '+source.title+' '+source.snippet);
  const candidates=[];
  for(const img of [...document.querySelectorAll('img')].slice(0,150)) {
    const name=img.getAttribute('alt')||img.getAttribute('title')||'';
    const raw=img.getAttribute('data-src')||img.getAttribute('data-original')||img.getAttribute('src');
    if(!raw || (!pageIsChibi&&!CHIBI.test(name+' '+raw)))continue;
    if(/logo|banner|favicon|二维码|二维码|广告/i.test(name+' '+raw))continue;
    try {
      const imageUrl=sourceUrl(new URL(raw,url).href);
      if(!imageUrl.startsWith('https:'))continue;
      candidates.push({imageUrl,url,title:title.slice(0,200),name:name.slice(0,150)});
    }catch{}
  }
  return [...new Map(candidates.map(c=>[c.imageUrl,c])).values()].slice(0,12);
}
function createChibiReferences({search,publicResource,inspectImage,verify,fallbackImage}) {
  async function discover(character,settings,credentials,onProgress=()=>{}) {
    const pack=referencePack(character);
    onProgress({stage:'Q版参考检索',detail:`先搜索 ${character.name} 在 ${character.work} 中已有的 Q 版／表情包形象…`});
    let result;
    try { result=await search(character,settings,credentials); }
    catch(e){throw Error(`Q版参考搜索未完成：${e.message}。请检查搜索设置后重试；不会把搜索失败当作没有参考。`);}
    const sources=result.sources||[],warnings=[...(result.warnings||[])];
    let readPages=0,downloads=0,downloadErrors=0;
    const candidates=[];
    for(const source of sources.slice(0,6)) {
      try {
        const response=await publicResource(source.url,{label:'Q版图片来源页',limit:2*1024*1024,timeout:20000,accept:'text/html',httpsOnly:true});
        if(!/html/i.test(response.contentType||''))continue;
        readPages++;
        candidates.push(...pageChibiImages(response.bytes,response.url,source));
      } catch(e){warnings.push(`来源页未读取：${String(e.message).slice(0,150)}`);}
    }
    if(sources.length && !readPages)throw Error('Q版搜索有结果，但图片来源页都无法读取。请重试或更换搜索服务；尚不能判断没有现成形象。');
    const unique=[...new Map(candidates.map(c=>[c.imageUrl,c])).values()].slice(0,10);
    for(const candidate of unique) {
      let image;
      try {
        const response=await publicResource(candidate.imageUrl,{label:'Q版参考图下载',limit:8*1024*1024,timeout:20000,accept:'image/png,image/jpeg,image/webp',httpsOnly:true});
        const decoded=await inspectImage(response.bytes);
        if(decoded.width<96||decoded.height<96||decoded.width>4096||decoded.height>4096)continue;
        image=`data:${decoded.mime};base64,${response.bytes.toString('base64')}`;
        downloads++;
      }catch{downloadErrors++;continue;}
      onProgress({stage:'Q版参考核对',detail:'已取得图片，正在核对角色身份、Q版比例与可用性…'});
      // Model errors are not evidence of absence. Abort before any image generation.
      const verdict=await verify(character,pack.references.map(r=>r.image),image,settings,credentials);
      if(verdict?.sameCharacter!==true||verdict?.chibi!==true||verdict?.usable!==true||!(verdict.confidence>=0.8))continue;
      const summary=validateChibiResearch({status:'found',checkedAt:new Date().toISOString(),reason:'已下载并通过模型核对的同角色 Q 版参考；网页来源不等于官方认证，请在基准审核时核对。',sources:[{title:candidate.title,url:candidate.url,imageUrl:candidate.imageUrl}],warnings:warnings.slice(0,8)});
      return {referenceDigest:pack.digest,summary,image,imageDigest:imageDigest(image)};
    }
    if(unique.length && !downloads && downloadErrors)throw Error('发现了候选 Q 版图片，但未能下载并核对。请重试，不会直接回退成没有参考。');
    const image=fallbackImage?await fallbackImage():`data:image/png;base64,${(await fs.readFile(path.join(__dirname,'../public/art/chibi-fallback-furina.png'))).toString('base64')}`;
    const summary=validateChibiResearch({status:'fallback',checkedAt:new Date().toISOString(),reason:'本次检索未取得通过核对的同角色 Q 版图片，采用 Anime Codex 芙宁娜贴纸画风；这不表示网上一定不存在。',sources:sources.slice(0,6).map(s=>({title:s.title,url:s.url})),warnings:warnings.slice(0,8)});
    onProgress({stage:'Q版画风选择',detail:summary.reason});
    return {referenceDigest:pack.digest,summary,image,imageDigest:imageDigest(image)};
  }
  return {discover};
}
module.exports={createChibiReferences,pageChibiImages,validateChibiResearch};
