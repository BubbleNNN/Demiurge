'use strict';
const {parseHTML}=require('linkedom');
const {sourceUrl}=require('./sources.cjs');
const {referencePack,imageDigest}=require('./references.cjs');
const {characterAliases,matchText}=require('./research.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const CHIBI=/q\s*版|表情|贴纸|貼紙|貼圖|贴图|chibi|sticker|emote|emoji|sd\s*character|meme|ppg|ちび|スタンプ|デフォルメ|표정|스티커|이모티콘/i;
const NOISE=/logo|banner|favicon|二维码|广告|背景|background|按钮|button|分隔|divider|\/static\/|\/assets?\/|placeholder|loading|spinner|avatar|noface|\/default[._-]/i;
// Plain UI icons are not stickers; an "Icon Emoji ..." file is.
const ICON=/^icon\b|\bicon\.|图标|圖標/i;
const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
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
    if(NOISE.test(name+' '+raw))continue;
    try {
      const imageUrl=sourceUrl(new URL(raw,url).href);
      if(!imageUrl.startsWith('https:')||NOISE.test(imageUrl))continue;
      candidates.push({imageUrl,url,title:title.slice(0,200),name:name.slice(0,150)});
    }catch{}
  }
  return [...new Map(candidates.map(c=>[c.imageUrl,c])).values()].slice(0,12);
}
// Structured readers. Wiki pages block plain HTML reads or lazy-load their galleries, and the
// HoYoverse community sites render in the browser, yet all three publish the same images as JSON.
function mediaWikiPage(url) {
  const parsed=new URL(url);
  const match=/^(.*?)\/wiki\/(.+)$/.exec(parsed.pathname);
  if(!match)return null;
  // Fandom serves api.php beside /wiki/; Wikipedia and most self-hosted wikis serve it under /w/.
  const api=new URL(parsed.origin+match[1]+'/api.php');
  const alternate=new URL(parsed.origin+match[1]+'/w/api.php');
  let title;
  try { title=decodeURIComponent(match[2]).replace(/_/g,' '); } catch { title=match[2]; }
  const category=/^(?:Category|分类|分類|カテゴリ):/i.test(title)?title:null;
  return {api:api.href,alternate:alternate.href,title,category};
}
function communityPost(url) {
  const parsed=new URL(url);
  const host=parsed.hostname.replace(/^www\./,'');
  const id=/\/article\/(\d{3,20})(?:$|[/?#])/.exec(parsed.pathname)?.[1];
  if(!id)return null;
  if(host==='hoyolab.com')return {api:`https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${id}`,referer:'https://www.hoyolab.com/'};
  if(host==='miyoushe.com'||host==='bbs.mihoyo.com')return {api:`https://bbs-api.miyoushe.com/post/wapi/getPostFull?post_id=${id}`,referer:'https://www.miyoushe.com/'};
  return null;
}
// MediaWiki thumbnail routes re-encode on request; `format=original` returns the uploaded file.
function originalImageUrl(imageUrl) {
  try {
    const url=new URL(imageUrl);
    if(/\/revision\/(?:latest|\d+)/.test(url.pathname)&&!url.searchParams.has('format'))url.searchParams.set('format','original');
    return url.href;
  } catch { return imageUrl; }
}
function wikiLangNames(data) {
  const names=[];
  for(const page of data?.query?.pages||[]) {
    if(page.title)names.push(String(page.title));
    for(const link of page.langlinks||[])if(link?.title)names.push(String(link.title));
  }
  return names.map(name=>name.replace(/\s*\([^)]*\)\s*$/,'').trim()).filter(name=>name.length>=2).slice(0,12);
}
function wikiQuery(api,params) {
  const url=new URL(api);
  for(const [k,v] of Object.entries({action:'query',format:'json',formatversion:'2',prop:'imageinfo',iiprop:'url|size|mime',...params}))url.searchParams.set(k,v);
  return url.href;
}
function wikiCandidates(data,pageUrl,pageTitle) {
  const items=[];
  for(const page of data?.query?.pages||[]) {
    const info=page.imageinfo?.[0];
    const name=String(page.title||'').replace(/^(?:File|文件|檔案|Archivo|Fichier):/i,'');
    if(!info?.url||!IMAGE_TYPES.has(info.mime)||NOISE.test(name)||(ICON.test(name)&&!CHIBI.test(name)))continue;
    if(!(info.width>=128&&info.height>=128&&info.width<=4096&&info.height<=4096))continue;
    try { items.push({imageUrl:sourceUrl(info.url),url:pageUrl,title:pageTitle.slice(0,200),name:name.slice(0,150),width:info.width,height:info.height}); } catch {}
  }
  return items;
}
function postCandidates(data,pageUrl) {
  const post=data?.data?.post;
  if(data?.retcode!==0||!post)throw Error('帖子接口没有返回内容。');
  const title=String(post.post?.subject||'').slice(0,200);
  const items=[];
  for(const image of (post.image_list||[]).slice(0,40)) {
    if(!image?.url)continue;
    const width=Number(image.width),height=Number(image.height);
    if(Number.isFinite(width)&&Number.isFinite(height)&&(width<128||height<128))continue;
    try { items.push({imageUrl:sourceUrl(image.url),url:pageUrl,title,name:'',snippet:String(post.post?.content||'').replace(/<[^>]+>/g,' ').slice(0,300),width,height}); } catch {}
  }
  return items;
}
// Highest first: the character's own name on the file, then chibi wording, then a chibi page.
// A candidate with no chibi wording anywhere is ordinary art and is not worth a model call.
function rank(candidate,aliases) {
  const own=matchText(candidate.name+' '+candidate.imageUrl.split('/').pop());
  const page=matchText(candidate.title);
  let decoded=candidate.imageUrl;
  try { decoded=decodeURIComponent(candidate.imageUrl); } catch {}
  let score=0;
  if(aliases.some(alias=>own.includes(alias)))score+=8;
  else if(aliases.some(alias=>page.includes(alias)))score+=2;
  if(CHIBI.test(candidate.name+' '+decoded))score+=4;
  else if(CHIBI.test(candidate.title+' '+(candidate.snippet||'')))score+=1;
  else return -1;
  return score;
}
function createChibiReferences({search,publicResource,inspectImage,verify,fallbackImage}) {
  const readJson=async (url,label,referer)=>{
    const response=await publicResource(url,{label,limit:4*1024*1024,timeout:20000,accept:'application/json',httpsOnly:true,headers:referer?{Referer:referer}:{}});
    if(/html/i.test(response.contentType||''))throw Error(`${label}返回了网页而不是数据。`);
    return JSON.parse(response.bytes.toString('utf8'));
  };
  // One wiki call, retried at the alternate api.php location when the first does not exist.
  const wikiRead=async (wiki,params,label)=>{
    try { return await readJson(wikiQuery(wiki.api,params),label); }
    catch(error) {
      if(!wiki.alternate||!/HTTP 404|网页而不是数据/.test(error.message))throw error;
      return readJson(wikiQuery(wiki.alternate,params),label);
    }
  };
  // The character's page on each wiki links its other-language titles: free, exact aliases.
  async function wikiAliases(sources,known,warnings) {
    const names=[];
    const seen=new Set();
    for(const source of sources.slice(0,6)) {
      let wiki;
      try { wiki=mediaWikiPage(source.url); } catch { continue; }
      if(!wiki)continue;
      const base=wiki.title.split('/')[0];
      // Only the character's own page carries the character's names; galleries carry their own.
      if(seen.has(wiki.api+'#'+base)||!known.some(alias=>matchText(base).includes(alias)))continue;
      seen.add(wiki.api+'#'+base);
      try { names.push(...wikiLangNames(await wikiRead(wiki,{titles:base,prop:'langlinks',lllimit:'50'},'Wiki 多语言名称'))); }
      catch(error){ warnings.push(`Wiki 多语言名称未读取：${String(error.message).slice(0,120)}`); }
    }
    return names;
  }
  async function structured(source,aliases,warnings) {
    const wiki=mediaWikiPage(source.url);
    if(wiki) {
      const items=[];
      // A category page lists its files; any other page lists the images it shows.
      const onPage=await wikiRead(wiki,wiki.category
        ? {generator:'categorymembers',gcmtitle:wiki.category,gcmnamespace:'6',gcmlimit:'200'}
        : {generator:'images',titles:wiki.title,gimlimit:'200'},'Wiki 图片接口');
      items.push(...wikiCandidates(onPage,source.url,source.title||wiki.title));
      // Galleries list every character; the file namespace finds this character's own files.
      for(const alias of aliases.slice(0,4)) {
        try {
          const found=await wikiRead(wiki,{generator:'search',gsrsearch:alias,gsrnamespace:'6',gsrlimit:'50'},'Wiki 文件检索');
          items.push(...wikiCandidates(found,source.url,source.title||wiki.title));
        } catch(error) { warnings.push(`Wiki 文件检索未完成：${String(error.message).slice(0,150)}`); }
      }
      return items;
    }
    const post=communityPost(source.url);
    if(post)return postCandidates(await readJson(post.api,'社区帖子接口',post.referer),source.url);
    return null;
  }
  async function discover(character,settings,credentials,onProgress=()=>{}) {
    const pack=referencePack(character);
    onProgress({stage:'Q版参考检索',detail:`先搜索 ${character.name} 在 ${character.work} 中已有的 Q 版／表情包形象…`});
    let result;
    try { result=await search(character,settings,credentials); }
    catch(e){throw Error(`Q版参考搜索未完成：${e.message}。请检查搜索设置后重试；不会把搜索失败当作没有参考。`);}
    const sources=result.sources||[],warnings=[...(result.warnings||[])];
    // Typed name, names the search answered with, then each wiki's interlanguage titles.
    const known=characterAliases({...character,aliases:[...(character.aliases||[]),...(result.aliases||[])]});
    const aliases=characterAliases({...character,aliases:[...(character.aliases||[]),...(result.aliases||[]),...(await wikiAliases(sources,known,warnings))]}).slice(0,8);
    let readPages=0,downloads=0,downloadErrors=0;
    const candidates=[];
    for(const source of sources.slice(0,6)) {
      try {
        const items=await structured(source,aliases,warnings);
        if(items) { readPages++; candidates.push(...items); continue; }
        const response=await publicResource(source.url,{label:'Q版图片来源页',limit:2*1024*1024,timeout:20000,accept:'text/html',httpsOnly:true});
        if(!/html/i.test(response.contentType||''))continue;
        readPages++;
        candidates.push(...pageChibiImages(response.bytes,response.url,source));
      } catch(e){warnings.push(`来源页未读取：${String(e.message).slice(0,150)}`);}
    }
    if(sources.length && !readPages)throw Error('Q版搜索有结果，但图片来源页都无法读取。请重试或更换搜索服务；尚不能判断没有现成形象。');
    const unique=[...new Map(candidates.map(c=>[c.imageUrl,c])).values()]
      .map(c=>({...c,score:rank(c,aliases)}))
      .filter(c=>c.score>=0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,8);
    if(unique.length)onProgress({stage:'Q版参考核对',detail:`找到 ${unique.length} 张候选图片，按角色名与 Q 版线索排序后逐张核对…`});
    const downloadFailures=[];
    for(const candidate of unique) {
      let image;
      try {
        // Ask image hosts for the stored file: the Fandom CDN otherwise negotiates WebP, which
        // the desktop decoder cannot read, and it refuses downloads without a page referer.
        const response=await publicResource(originalImageUrl(candidate.imageUrl),{label:'Q版参考图下载',limit:8*1024*1024,timeout:20000,accept:'image/png,image/jpeg;q=0.9,image/webp;q=0.5',httpsOnly:true,headers:{Referer:candidate.url}});
        const decoded=await inspectImage(response.bytes);
        if(decoded.width<96||decoded.height<96||decoded.width>4096||decoded.height>4096)continue;
        image=`data:${decoded.mime};base64,${response.bytes.toString('base64')}`;
        downloads++;
      }catch(error){downloadErrors++;downloadFailures.push(`${candidate.name||candidate.imageUrl.split('/').pop().slice(0,60)}：${String(error.message).slice(0,120)}`);continue;}
      onProgress({stage:'Q版参考核对',detail:`正在核对「${candidate.name||candidate.title||'候选图片'}」的角色身份、Q版比例与可用性…`});
      // Model errors are not evidence of absence. Abort before any image generation.
      const verdict=await verify(character,pack.references.map(r=>r.image),image,settings,credentials);
      if(verdict?.sameCharacter!==true||verdict?.chibi!==true||verdict?.usable!==true||!(verdict.confidence>=0.8))continue;
      const summary=validateChibiResearch({status:'found',checkedAt:new Date().toISOString(),reason:`已下载并通过模型核对的同角色 Q 版参考${candidate.name?`「${candidate.name.slice(0,60)}」`:''}；网页来源不等于官方认证，请在基准审核时核对。`,sources:[{title:candidate.title||'图片来源',url:candidate.url,imageUrl:candidate.imageUrl}],warnings:warnings.slice(0,8)});
      return {referenceDigest:pack.digest,summary,image,imageDigest:imageDigest(image)};
    }
    if(unique.length && !downloads && downloadErrors)throw Error(`发现了候选 Q 版图片，但未能下载并核对（${downloadFailures.slice(0,2).join('；')}）。请重试，不会直接回退成没有参考。`);
    warnings.push(...downloadFailures.slice(0,2).map(failure=>`候选图片未能使用：${failure}`));
    const image=fallbackImage?await fallbackImage():`data:image/png;base64,${(await fs.readFile(path.join(__dirname,'../public/art/chibi-fallback-furina.png'))).toString('base64')}`;
    const summary=validateChibiResearch({status:'fallback',checkedAt:new Date().toISOString(),reason:`本次检索${unique.length?`核对了 ${Math.min(downloads,unique.length)} 张候选但没有通过`:'未取得候选图片'}，采用 Anime Codex 芙宁娜贴纸画风；这不表示网上一定不存在。`,sources:sources.slice(0,6).map(s=>({title:s.title,url:s.url})),warnings:warnings.slice(0,8)});
    onProgress({stage:'Q版画风选择',detail:summary.reason});
    return {referenceDigest:pack.digest,summary,image,imageDigest:imageDigest(image)};
  }
  return {discover};
}
module.exports={createChibiReferences,pageChibiImages,validateChibiResearch,mediaWikiPage,communityPost,wikiCandidates,postCandidates,wikiLangNames,originalImageUrl,rank};
