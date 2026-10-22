// Offline production-source selection, partial-style controls and character renderer.
// node tests/fixtures/sync_creator_style_selection_server.mjs /path/to/react18/node_modules [port]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modules = process.argv[2];
if (!modules) throw new Error('Pass a React 18 node_modules directory');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`Missing production section: ${start}`);
  return source.slice(from, to);
};
function fixture() {
  const source = readFileSync(resolve(root, 'SyncDataCreator.js'), 'utf8');
  const part = (start, end) => section(source, start, end);
  return `${source.slice(0, source.indexOf('const SyncDataCreator ='))}
const react=React;const {useState,useRef,useEffect,useMemo,useCallback}=React;
const language=new URLSearchParams(location.search).get('language')||'en';
const dictionary=language==='ko'?window.LANG_KO:window.LANG_EN;
const I18n={t:key=>key.split('.').reduce((value,part)=>value?.[part],dictionary)||key};
const Toast={success(){},error:message=>{throw new Error(message)}};
const noop=()=>{};
function SelectionFixture(){
  const [mode,setMode]=useState('idle'),[activeParallelTargetId,setTarget]=useState('full');
  const [syncData,setSyncData]=useState({version:5,lines:[{start:10,end:15,chars:[1,2,3,4,5,6],speaker:'NORMAL',kind:'vocal'}]});
  const [lineStyleDrafts,setLineStyleDrafts]=useState({});
  const [bulkCustomSpeakerColor,setBulkCustomSpeakerColor]=useState(''),[bulkCustomSpeakerFallback,setBulkCustomSpeakerFallback]=useState('MALE 1');
  const customSpeakerMetaMemoryRef=useRef(new Map()),wholeTargetWrites=useRef([]),trackId='fixture';
  const currentLineStart=10,currentLineIndex=0,currentFullLineChars=useMemo(()=>Array.from('ABCDEF'),[]),lyricsLines=['ABCDEF'];
  const currentLineCharRefs=useMemo(()=>(activeParallelTargetId==='full'?[0,1,2,3,4,5]:[2,3,5]).map(index=>({absoluteIndex:10+index,localIndex:index,char:currentFullLineChars[index]})),[activeParallelTargetId]);
  const currentLineChars=useMemo(()=>currentLineCharRefs.map(ref=>ref.char),[currentLineCharRefs]),currentLineText=currentLineChars.join('');
  const activeParallelPart=activeParallelTargetId==='full'?null:{id:'part',role:'background',speaker:'NORMAL',kind:'vocal'};
  const currentLineMeta={speaker:'NORMAL',kind:'vocal',...syncData.lines[0]};
  const currentLineStyleRanges=lineStyleDrafts[currentLineStart]||syncData.lines[0].styleRanges||[];
  const charElementsRef=useRef([]),scorePendingEffectsRef=useRef(new Map());
  const rightLockDragStartRef=useRef(-1),isRightLockDraggingRef=useRef(false),rightOffsetDragStartRef=useRef(-1),isRightOffsetDraggingRef=useRef(false),suppressNextLockContextMenuRef=useRef(false);
  const isCurrentSyncTargetMetaComplete=true,syncGranularity='character',currentSpeakerTextColor='#f2f4f7',currentSpeakerMutedColor='#999';
  const getGranularityRangeForIndex=useCallback(index=>({start:index,end:index}),[]);
  const getCharIndexFromPoint=useCallback(x=>{
    const distances=charElementsRef.current.slice(0,currentLineChars.length).map((element,index)=>({index,distance:Math.abs(x-(element.getBoundingClientRect().left+element.getBoundingClientRect().width/2))}));
    return distances.sort((a,b)=>a.distance-b.distance)[0]?.index??-1;
  },[currentLineChars.length]);
  const showMissingMetaToast=noop,clearRecordingLock=noop,getCurrentSyncTargetSavedChars=()=>syncData.lines[0].chars,getActiveRecordingLockRange=()=>null,setRecordingLockRangeValue=noop,setRecordingLockIndexValue=noop,buildLockedCharTimes=()=>[],setRecordingProgressIndex=noop,handleDragStart=noop,applyRecordingLockRange=noop,claimSessionForLocalEditing=noop;
  ${part('\tconst [offsetSelectionRange, setOffsetSelectionRange]', '\tconst applyRecordingLockRange =')}
  ${part('\tconst handleContainerMouseDown =', '\n\tuseEffect(() => {\n\t\tif (!isDragging)')}
  ${part('\tuseEffect(() => {\n\t\tconst handleRightMove =', '\t// 현재 줄 싱크 삭제')}
  ${part('\tconst updateCurrentLineStyleRanges =', '\tconst applySongVocalSpeaker =')}
  ${part('\t// Clear offset selection whenever', '\tuseEffect(() => {\n\t\tif (!syncLinesByStart')}
  const usePrimaryCharacterPronunciation=false,hasCurrentLineFurigana=false,hasCurrentLineCharacterPronunciation=false,currentLineRenderedPronunciationUnits=[];
  ${part('\tconst TOSS_BLUE =', '\tconst currentLineData =')}
  const textEffectsDisabled=true;
  ${part('\tconst getSpeakerTone =', '\tconst renderBulkSpeakerControl =')}
  const renderBulkSpeakerControl=()=>null;
  const updateCurrentLineMeta=(field,value)=>{wholeTargetWrites.current.push(['line',field,value]);setSyncData(previous=>({...previous,lines:previous.lines.map(line=>({...line,[field]:value}))}));};
  const updateParallelPartMeta=(id,field,value)=>{wholeTargetWrites.current.push(['part',id,field,value]);};
  ${part('\tconst updateCurrentTextEffect =', '\tconst renderGranularitySelector =')}
  const currentRecordingCharIndex=-1,isRecordingLockArmed=false,recordingLockRange=null,recordingLockIndex=-1,currentLockedPlaybackIndex=null,currentLinePreviewIndex=-1,useFixedPrimaryCharacterCells=false;
  const currentLineFuriganaMap=new Map(),currentLineCharacterPronunciationMap=new Map();
  const isCharSynced=()=>true,getCharSyncTime=(_,index)=>syncData.lines[0].chars[currentLineCharRefs[index].localIndex],formatSeconds=value=>value.toFixed(1)+'s';
  ${part('\tconst renderCharacterSpan =', '\tconst renderPronunciationUnit =')}
  window.selectionFixtureState={mode,target:activeParallelTargetId,range:offsetSelectionRange,syncData,lineStyleDrafts,wholeTargetWrites:wholeTargetWrites.current};
  return react.createElement('main',null,
    react.createElement('p',null,'Offline production-source fixture — no Spotify session or API calls'),
    react.createElement('nav',null,...['full','part'].map(value=>react.createElement('button',{key:value,'data-fixture-target':value,onClick:()=>setTarget(value)},value)),react.createElement('button',{'data-fixture-mode':true,onClick:()=>setMode(value=>value==='record'?'idle':'record')},mode)),
    react.createElement('div',{id:'lyric-row',style:{...s.lyricsBox,...s.stageLyricsBox,overflowX:'auto'},onMouseDown:handleContainerMouseDown},react.createElement('div',{style:s.lyricsLine},currentLineChars.map((char,index)=>renderCharacterSpan(char,index)))),
    react.createElement('div',{id:'effect-strip'},renderTextEffectPicker(
      shouldUseSyncCreatorSelectionEffect({mode,activeParallelPart,offsetSelectionRange})
        ?resolveSyncCreatorSelectionEffectKind({styleRanges:currentLineStyleRanges,charRefs:currentLineCharRefs,range:offsetSelectionRange}):currentLineMeta.kind,
      updateCurrentTextEffect,{compact:true,allowEmpty:shouldUseSyncCreatorSelectionEffect({mode,activeParallelPart,offsetSelectionRange})})),
    react.createElement('div',{id:'inspector'},renderLineInspector()));
}
ReactDOM.createRoot(document.getElementById('root')).render(react.createElement(SelectionFixture));`;
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Partial style selection fixture</title>
<link rel="stylesheet" href="/style.css"><style>:root{--spice-text:#f2f4f7;--spice-subtext:#aeb5bf;--spice-rgb-accent:30,215,96;--spice-rgb-text:242,244,247;--font-family:system-ui}body{margin:0;background:#0f1215;color:var(--spice-text);font-family:system-ui}main{box-sizing:border-box;max-width:1000px;margin:24px auto;padding:20px}main>p{font-size:12px;color:var(--spice-subtext)}nav{display:flex;gap:8px;margin:20px 0}nav button{padding:8px 14px;background:#20252b;color:var(--spice-text);border:1px solid #444;border-radius:6px}</style>
<script src="/react.js"></script><script src="/react-dom.js"></script><script src="/langs/LangEn.js"></script><script src="/langs/LangKo.js"></script><div id="root"></div><script src="/fixture.js"></script>`;
const files = new Map([
  ['/react.js',resolve(modules,'react/umd/react.development.js')],['/react-dom.js',resolve(modules,'react-dom/umd/react-dom.development.js')],
  ...['style.css','langs/LangEn.js','langs/LangKo.js'].map(path=>['/'+path,resolve(root,path)]),
]);
const server=createServer((request,response)=>{
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  try{
    if(path==='/favicon.ico'){response.writeHead(204);response.end();return;}
    if(path!=='/'&&path!=='/fixture.js'&&!files.has(path)){response.writeHead(404);response.end();return;}
    let body=path==='/'?html:path==='/fixture.js'?fixture():readFileSync(files.get(path));
    if(path==='/style.css')body=body.toString().replace(/@import\s+url\(["']?https?:\/\/[^)]+\)\s*;/g,'');
    response.writeHead(200,{'Content-Type':path==='/'?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':'application/javascript; charset=utf-8','Cache-Control':'no-store'});response.end(body);
  }catch(error){response.writeHead(500);response.end(error.stack);}
});
server.listen(Number(process.argv[3]||0),'127.0.0.1',()=>console.log('Selection fixture: http://127.0.0.1:'+server.address().port));
