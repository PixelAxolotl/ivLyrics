// ============================================
// LyricsService Extension for ivLyrics
// 가사, 번역, 발음을 불러오는 시스템을 Extension 형태로 분리
// Spotify의 모든 페이지에서 작동 가능
// ============================================

(function LyricsServiceExtension() {
    "use strict";

    const MODULE_KEY = "__ivLyricsLyricsServiceModule";
    const moduleState = window[MODULE_KEY] || (window[MODULE_KEY] = {
        initialized: false,
        waitTimer: null
    });

    // Spicetify가 준비될 때까지 대기
    if (!window.Spicetify || !Spicetify.LocalStorage) {
        if (!moduleState.waitTimer) {
            moduleState.waitTimer = setTimeout(() => {
                moduleState.waitTimer = null;
                LyricsServiceExtension();
            }, 300);
        }
        return;
    }

    moduleState.waitTimer = null;
    if (moduleState.initialized) {
        return;
    }
    moduleState.initialized = true;

    const restoreRouteAfterReload = () => {
        const FLAG_KEY = "ivLyrics:restore-route-after-reload";
        let attempts = 0;

        const tryRestore = () => {
            attempts += 1;

            let payload = null;
            try {
                const rawValue = localStorage.getItem(FLAG_KEY);
                if (!rawValue) return;
                payload = JSON.parse(rawValue);
            } catch (error) {
                localStorage.removeItem(FLAG_KEY);
                return;
            }

            if (!payload?.path) {
                localStorage.removeItem(FLAG_KEY);
                return;
            }

            if (payload.expiresAt && Date.now() > payload.expiresAt) {
                localStorage.removeItem(FLAG_KEY);
                return;
            }

            const history = Spicetify.Platform?.History;
            if (!history?.push || !history?.location) {
                if (attempts < 40) {
                    setTimeout(tryRestore, 150);
                }
                return;
            }

            const currentPath = history.location.pathname || "";
            if (currentPath.startsWith(payload.path)) {
                localStorage.removeItem(FLAG_KEY);
                return;
            }

            history.push(payload.path);
            localStorage.removeItem(FLAG_KEY);
        };

        tryRestore();
    };

    restoreRouteAfterReload();

    const LYRICS_SERVICE_DEBUG = false;
    const serviceDebug = (...args) => {
        if (LYRICS_SERVICE_DEBUG) {
            console.log(...args);
        }
    };
    const helperDebug = (...args) => {
        if (LYRICS_SERVICE_DEBUG) {
            console.log(...args);
        }
    };

    const cleanupWorker = (worker) => {
        if (!worker) return;
        try {
            worker.postMessage('stop');
        } catch (e) { }
        try {
            worker.terminate();
        } catch (e) { }
    };
    const clearSettingsPolling = (target) => {
        if (!target) return;
        if (target._settingsTimer) {
            clearInterval(target._settingsTimer);
            target._settingsTimer = null;
        }
        target._isSettingsOpen = false;
    };

    serviceDebug("[LyricsService] Initializing LyricsService Extension...");

    // ============================================
    // LRU Cache implementation for better cache performance
    // ============================================
    class LRUCache {
        constructor(maxSize = 100) {
            this.cache = new Map();
            this.maxSize = maxSize;
        }

        get(key) {
            if (!this.cache.has(key)) return undefined;
            const value = this.cache.get(key);
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        set(key, value) {
            if (this.cache.has(key)) this.cache.delete(key);
            this.cache.set(key, value);
            if (this.cache.size > this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
        }

        has(key) {
            return this.cache.has(key);
        }

        get size() {
            return this.cache.size;
        }

        clear() {
            this.cache.clear();
        }
    }

    // ============================================
    // Utils - 유틸리티 함수들 (Extension 전용)
    // ============================================
    const Utils = {
        _langDetectCache: new Map(),
        _maxLangCacheSize: 500,
        _cjkMatchRegex: null,

        _cacheLanguageResult(cacheKey, result) {
            if (this._langDetectCache.size >= this._maxLangCacheSize) {
                const firstKey = this._langDetectCache.keys().next().value;
                this._langDetectCache.delete(firstKey);
            }
            this._langDetectCache.set(cacheKey, result);
        },

        detectLanguage(lyrics) {
            // Safe array check
            if (!lyrics || !Array.isArray(lyrics) || lyrics.length === 0) {
                return null;
            }

            // Safe text extraction
            const extractTextSafely = (line) => {
                if (!line) return "";
                if (typeof line === "string") return line;
                if (typeof line === "object") {
                    if (line.$$typeof) return ""; // React element
                    return line.originalText || line.text || "";
                }
                return String(line || "");
            };

            let cacheKey = "";
            for (const line of lyrics) {
                const text = extractTextSafely(line);
                if (!text) continue;
                cacheKey = cacheKey ? `${cacheKey} ${text}` : text;
                if (cacheKey.length >= 200) {
                    cacheKey = cacheKey.substring(0, 200);
                    break;
                }
            }
            if (!cacheKey) {
                return null;
            }
            if (this._langDetectCache.has(cacheKey)) {
                return this._langDetectCache.get(cacheKey);
            }

            const rawLyrics = lyrics.map(extractTextSafely).join(" ");
            if (!rawLyrics || rawLyrics.length === 0) {
                return null;
            }

            // Language detection regex patterns
            const kanaRegex = /[\u3001-\u3003]|[\u3005\u3007]|[\u301d-\u301f]|[\u3021-\u3035]|[\u3038-\u303a]|[\u3040-\u30ff]|[\uff66-\uff9f]/gu;
            const hangulRegex = /(\S*[\u3131-\u314e|\u314f-\u3163|\uac00-\ud7a3]+\S*)/g;
            const simpRegex = /[万与丑专业丛东丝丢两严丧个丬丰临为丽举么义乌乐乔习乡书买乱争于亏云亘亚产亩亲亵亸亿仅从仑仓仪们价众优伙会伛伞伟传伤伥伦伧伪伫体余佣佥侠侣侥侦侧侨侩侪侬俣俦俨俩俪俭债倾偬偻偾偿傥傧储傩儿兑兖党兰关兴兹养兽冁内冈册写军农冢冯冲决况冻净凄凉凌减凑凛几凤凫凭凯击凼凿刍划刘则刚创删别刬刭刽刿剀剂剐剑剥剧劝办务劢动励劲劳势勋勐勚匀匦匮区医华协单卖卢卤卧卫却卺厂厅历厉压厌厍厕厢厣厦厨厩厮县参叆叇双发变叙叠叶号叹叽吁后吓吕吗吣吨听启吴呒呓呕呖呗员呙呛呜咏咔咙咛咝咤咴咸哌响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唣唤唿啧啬啭啮啰啴啸喷喽喾嗫呵嗳嘘嘤嘱噜噼嚣嚯团园囱围囵国图圆圣圹场坂坏块坚坛坜坝坞坟坠垄垅垆垒垦垧垩垫垭垯垱垲垴埘埙埚埝埯堑堕塆墙壮声壳壶壸处备复够头夸夹夺奁奂奋奖奥妆妇妈妩妪妫姗姜娄娅娆娇娈娱娲娴婳婴婵婶媪嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尧尴尸尽层屃屉届属屡屦屿岁岂岖岗岘岙岚岛岭岳岽岿峃峄峡峣峤峥峦崂崃崄崭嵘嵚嵛嵝嵴巅巩巯币帅师帏帐帘帜带帧帮帱帻帼幂幞干并广庄庆庐庑库应庙庞废庼廪开异弃张弥弪弯弹强归当录彟彦彻径徕御忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恳恶恸恹恺恻恼恽悦悫悬悭悯惊惧惨惩惫惬惭惮惯愍愠愤愦愿慑慭憷懑懒懔戆戋戏戗战戬户扎扑扦执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捞损捡换捣据捻掳掴掷掸掺掼揸揽揿搀搁搂搅携摄摅摆摇摈摊撄撑撵撷撸撺擞攒敌敛数斋斓斗斩断无旧时旷旸昙昼昽显晋晒晓晔晕晖暂暧札术朴机杀杂权条来杨杩杰极构枞枢枣枥枧枨枪枫枭柜柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桊桠桡桢档桤桥桦桧桨桩梦梼梾检棂椁椟椠椤椭楼榄榇榈榉槚槛槟槠横樯樱橥橱橹橼檐檩欢欤欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵氇气氢氩氲汇汉污汤汹沓沟没沣沤沥沦沧沨沩沪沵泞泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浉浊测浍济浏浐浑浒浓浔浕涂涌涛涝涞涟涠涡涢涣涤润涧涨涩淀渊渌渍渎渐渑渔渖渗温游湾湿溃溅溆溇滗滚滞滟滠满滢滤滥滦滨滩滪漤潆潇潋潍潜潴澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煅煳熘爱爷牍牦牵牺犊犟状犷犸犹狈狍狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玚玛玮环现玱玺珉珏珐珑珰珲琎琏琐琼瑶瑷璇璎瓒瓮瓯电画畅畲畴疖疗疟疠疡疬疮疯疱疴痈痉痒痖痨痪痫痴瘅瘆瘗瘘瘪瘫瘾瘿癞癣癫癯皑皱皲盏盐监盖盗盘眍眦眬着睁睐睑瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硅硕硖硗硙硚确硷碍碛碜碱碹磙礼祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筑筚筛筜筝筹签简箓箦箧箨箩箪箫篑篓篮篱簖籁籴类籼粜粝粤粪粮糁糇紧絷纟纠纡红纣纤纥约级纨纩纪纫纬纭纮纯纰纱纲纳纴纵纶纷纸纹纺纻纼纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绤绥绦继绨绩绪绫绬续绮绯绰绱绲绳维绵绶绷绸绹绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缍缎缏缐缑缒缓缔缕编缗缘缙缚缛缜缝缞缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢罴羁羟羡翘翙翚耢耧耸耻聂聋职聍联聵聽聰肅腸膚膁腎腫脹脅膽勝朧腖臚脛膠脈膾髒臍腦膿臠腳脫腡臉臘醃膕齶膩靦膃騰臏臢輿艤艦艙艫艱豔艸藝節羋薌蕪蘆蓯葦藶莧萇蒼苧蘇檾蘋莖蘢蔦塋煢繭荊薦薘莢蕘蓽蕎薈薺蕩榮葷滎犖熒蕁藎蓀蔭蕒葒葤藥蒞蓧萊蓮蒔萵薟獲蕕瑩鶯蓴蘀蘿螢營縈蕭薩蔥蕆蕢蔣蔞藍薊蘺蕷鎣驀薔蘞藺藹蘄蘊藪槁蘚虜慮虛蟲虯虮雖蝦蠆蝕蟻螞蠶蠔蜆蠱蠣蟶蠻蟄蛺蟯螄蠐蛻蝸蠟蠅蟈蟬蠍螻蠑螿蟎蠨釁銜補襯袞襖嫋褘襪襲襏裝襠褌褳襝褲襇褸襤繈襴見觀覎規覓視覘覽覺覬覡覿覥覦覯覲覷觴觸觶讋譽謄訁計訂訃認譏訐訌討讓訕訖訓議訊記訒講諱謳詎訝訥許訛論訩訟諷設訪訣證詁訶評詛識詗詐訴診詆謅詞詘詔詖譯詒誆誄試詿詩詰詼誠誅詵話誕詬詮詭詢詣諍該詳詫諢詡譸誡誣語誚誤誥誘誨誑說誦誒請諸諏諾讀諑誹課諉諛誰諗調諂諒諄誶談誼謀諶諜謊諫諧謔謁謂諤諭諼讒諮諳諺諦謎諞諝謨讜謖謝謠謗諡謙謐謹謾謫譾謬譚譖譙讕譜譎讞譴譫讖穀豶貝貞負貟貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貰貼貴貺貸貿費賀貽賊贄賈賄貲賃賂贓資賅贐賕賑賚賒賦賭齎贖賞賜贔賙賡賠賧賴賵贅賻賺賽賾贗讚贇贈贍贏贛赬趙趕趨趲躉躍蹌蹠躒踐躂蹺蹕躚躋踴躊蹤躓躑躡蹣躕躥躪躦軀車軋軌軑軔轉軛輪軟轟軲軻轤軸軹軼軤軫轢軺輕軾載輊轎輈輇輅較輒輔輛輦輩輝輥輞輬輟輜輳輻輯轀輸轡轅轄輾轆轍轔辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡適選遜遞邐邏遺遙鄧鄺鄔郵鄒鄴鄰鬱郤郟鄶鄭鄆酈鄖鄲醞醱醬釅釃釀釋裏钜鑒鑾鏨釓釔針釘釗釙釕釷釺釧釤鈒釩釣鍆釹鍚釵鈃鈣鈈鈦鈍鈔鍾鈉鋇鋼鈑鈐鑰欽鈞鎢鉤鈧鈁鈥鈄鈕鈀鈺錢鉦鉗鈷缽鈳鉕鈽鈸鉞鑽鉬鉭鉀鈿鈾鐵鉑鈴鑠鉛鉚鈰鉉鉈鉍鈹鐸鉶銬銠鉺銪鋏鋣鐃銍鐺銅鋁銱銦鎧鍘銖銑鋌銩銛鏵銓鉿銚鉻銘錚銫鉸銥鏟銃鐋銨銀銣鑄鐒鋪鋙錸鋱鏈鏗銷鎖鋰鋥鋤鍋鋯鋨鏽銼鋝鋒鋅鋶鐦鐧銳銻鋃鋟鋦錒錆鍺錯錨錡錁錕錩錫錮鑼錘錐錦鍁錈錇錟錠鍵鋸錳錙鍥鍈鍇鏘鍶鍔鍤鍬鍾鍛鎪鍠鍰鎄鍍鎂鏤鎡鏌鎮鎛鎘鑷鐫鎳鎿鎦鎬鎊鎰鎔鏢鏜鏍鏰鏞鏡鏑鏃鏇鏐鐔钁鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐶鐲鐮鐿鑔鑣鑞鑲長門閂閃閆閈閉問闖閏闈閑閎間閔閌悶閘鬧閨聞闼閩閭闓閥閣閡閫鬮閱閬闍閾閹閶鬩閿閽閻閼闡闌闃闠闊闋闔闐闒闕闞闤隊陽陰陣階際陸隴陳陘陝隉隕險隨隱隸雋難雛讎靂霧霽黴靄靚靜靨韃鞽韉韝韋韌韍韓韙韞韜韻页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颒颓颔颕颖颗题颙颚颛颜额颞颟颠颡颢颣颤颥颦颧风飏飐飑飒飓飔飕飖飗飘飙飚飞飨餍饤饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饾饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骃骄骅骆骇骈骉骊骋验骍骎骏骐骑骒骓骔骕骖骗骘骙骚骛骜骝骞骟骠骡骢骣骤骥骦骧髅髋髌鬓魇魉鱼鱽鱾鱿鲀鲁鲂鲄鲅鲆鲇鲈鲉鲊鲋鲌鲍鲎鲏鲐鲑鲒鲓鲔鲕鲖鲗鲘鲙鲚鲛鲜鲝鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲪鲫鲬鲭鲮鲯鲰鲱鲲鲳鲴鲵鲶鲷鲸鲹鲺鲻鲼鲽鲾鲿鳀鳁鳂鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳑鳒鳓鳔鳕鳖鳗鳘鳙鳛鳜鳝鳞鳟鳠鳡鳢鳣鸟鸠鸡鸢鸣鸤鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸰鸱鸲鸳鸴鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹀鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹍鹎鹏鹐鹑鹒鹓鹔鹕鹖鹗鹘鹚鹛鹜鹝鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹯鹰鹱鹲鹳鹴鹾麦麸黄黉黡黩黪黾鼋鼌鼍鼗鼹齄齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟志制咨只里系范松没尝尝闹面准钟别闲干尽脏拼]/gu;
            const tradRegex = /[萬與醜專業叢東絲丟兩嚴喪個爿豐臨為麗舉麼義烏樂喬習鄉書買亂爭於虧雲亙亞產畝親褻嚲億僅從侖倉儀們價眾優夥會傴傘偉傳傷倀倫傖偽佇體餘傭僉俠侶僥偵側僑儈儕儂俁儔儼倆儷儉債傾傯僂僨償儻儐儲儺兒兌兗黨蘭關興茲養獸囅內岡冊寫軍農塚馮衝決況凍淨淒涼淩減湊凜幾鳳鳧憑凱擊氹鑿芻劃劉則剛創刪別剗剄劊劌剴劑剮劍剝劇勸辦務勱動勵勁勞勣勳猛勩勻匭匱區醫華協單賣盧鹵臥衛卻巹廠廳曆厲壓厭厙廁廂厴廈廚廄廝縣參靉靆雙發變敘疊葉號歎嘰籲後嚇呂嗎唚噸聽啟吳嘸囈嘔嚦唄員咼嗆嗚詠哢嚨嚀噝吒噅鹹呱響啞噠嘵嗶噦嘩噲嚌噥喲嘜嗊嘮啢嗩唕喚呼嘖嗇囀齧囉嘽嘯噴嘍嚳囁嗬噯噓嚶囑嚕劈囂謔團園囪圍圇國圖圓聖壙場阪壞塊堅壇壢壩塢墳墜壟壟壚壘墾坰堊墊埡墶壋塏堖塒塤堝墊垵塹墮壪牆壯聲殼壺壼處備複夠頭誇夾奪奩奐奮獎奧妝婦媽嫵嫗媯姍薑婁婭嬈嬌孌娛媧嫻嫿嬰嬋嬸媼嬡嬪嬙嬤孫學孿寧寶實寵審憲宮寬賓寢對尋導壽將爾塵堯尷屍盡層屭屜屆屬屢屨嶼歲豈嶇崗峴嶴嵐島嶺嶽崠巋嶨嶧峽嶢嶠崢巒嶗崍嶮嶄嶸嶔崳嶁脊巔鞏巰幣帥師幃帳簾幟帶幀幫幬幘幗冪襆幹並廣莊慶廬廡庫應廟龐廢廎廩開異棄張彌弳彎彈強歸當錄彠彥徹徑徠禦憶懺憂愾懷態慫憮慪悵愴憐總懟懌戀懇惡慟懨愷惻惱惲悅愨懸慳憫驚懼慘懲憊愜慚憚慣湣慍憤憒願懾憖怵懣懶懍戇戔戲戧戰戬戶紮撲扡執擴捫掃揚擾撫拋摶摳掄搶護報擔擬攏揀擁攔擰撥擇掛摯攣掗撾撻挾撓擋撟掙擠揮撏撈損撿換搗據撚擄摑擲撣摻摜摣攬撳攙擱摟攪攜攝攄擺搖擯攤攖撐攆擷擼攛擻攢敵斂數齋斕鬥斬斷無舊時曠暘曇晝曨顯晉曬曉曄暈暉暫曖劄術樸機殺雜權條來楊榪傑極構樅樞棗櫪梘棖槍楓梟櫃檸檉梔柵標棧櫛櫳棟櫨櫟欄樹棲樣欒棬椏橈楨檔榿橋樺檜槳樁夢檮棶檢欞槨櫝槧欏橢樓欖櫬櫚櫸檟檻檳櫧橫檣櫻櫫櫥櫓櫞簷檁歡歟歐殲歿殤殘殞殮殫殯毆毀轂畢斃氈毿氌氣氫氬氲彙漢汙湯洶遝溝沒灃漚瀝淪滄渢溈滬濔濘淚澩瀧瀘濼瀉潑澤涇潔灑窪浹淺漿澆湞溮濁測澮濟瀏滻渾滸濃潯濜塗湧濤澇淶漣潿渦溳渙滌潤澗漲澀澱淵淥漬瀆漸澠漁瀋滲溫遊灣濕潰濺漵漊潷滾滯灩灄滿瀅濾濫灤濱灘澦濫瀠瀟瀲濰潛瀦瀾瀨瀕灝滅燈靈災燦煬爐燉煒熗點煉熾爍爛烴燭煙煩燒燁燴燙燼熱煥燜燾煆糊溜愛爺牘犛牽犧犢強狀獷獁猶狽麅獮獰獨狹獅獪猙獄猻獫獵獼玀豬貓蝟獻獺璣璵瑒瑪瑋環現瑲璽瑉玨琺瓏璫琿璡璉瑣瓊瑤璦璿瓔瓚甕甌電畫暢佘疇癤療瘧癘瘍鬁瘡瘋皰屙癰痙癢瘂癆瘓癇癡癉瘮瘞瘺癟癱癮癭癩癬癲臒皚皺皸盞鹽監蓋盜盤瞘眥矓著睜睞瞼瞞矚矯磯礬礦碭碼磚硨硯碸礪礱礫礎硜矽碩硤磽磑礄確鹼礙磧磣堿镟滾禮禕禰禎禱禍稟祿禪離禿稈種積稱穢穠穭稅穌穩穡窮竊竅窯竄窩窺竇窶豎競篤筍筆筧箋籠籩築篳篩簹箏籌簽簡籙簀篋籜籮簞簫簣簍籃籬籪籟糴類秈糶糲粵糞糧糝餱緊縶糸糾紆紅紂纖紇約級紈纊紀紉緯紜紘純紕紗綱納紝縱綸紛紙紋紡紵紖紐紓線紺絏紱練組紳細織終縐絆紼絀紹繹經紿綁絨結絝繞絰絎繪給絢絳絡絕絞統綆綃絹繡綌綏絛繼綈績緒綾緓續綺緋綽緔緄繩維綿綬繃綢綯綹綣綜綻綰綠綴緇緙緗緘緬纜緹緲緝縕繢緦綞緞緶線緱縋緩締縷編緡緣縉縛縟縝縫縗縞纏縭縊縑繽縹縵縲纓縮繆繅纈繚繕繒韁繾繰繯繳纘罌網羅罰罷羆羈羥羨翹翽翬耮耬聳恥聶聾職聹聯聵聽聰肅腸膚膁腎腫脹脅膽勝朧腖臚脛膠脈膾髒臍腦膿臠腳脫腡臉臘醃膕齶膩靦膃騰臏臢輿艤艦艙艫艱豔艸藝節羋薌蕪蘆蓯葦藶莧萇蒼苧蘇檾蘋莖蘢蔦塋煢繭荊薦薘莢蕘蓽蕎薈薺蕩榮葷滎犖熒蕁藎蓀蔭蕒葒葤藥蒞蓧萊蓮蒔萵薟獲蕕瑩鶯蓴蘀蘿螢營縈蕭薩蔥蕆蕢蔣蔞藍薊蘺蕷鎣驀薔蘞藺藹蘄蘊藪槁蘚虜慮虛蟲虯虮雖蝦蠆蝕蟻螞蠶蠔蜆蠱蠣蟶蠻蟄蛺蟯螄蠐蛻蝸蠟蠅蟈蟬蠍螻蠑螿蟎蠨釁銜補襯袞襖嫋褘襪襲襏裝襠褌褳襝褲襇褸襤繈襴見觀覎規覓視覘覽覺覬覡覿覥覦覯覲覷觴觸觶讋譽謄訁計訂訃認譏訐訌討讓訕訖訓議訊記訒講諱謳詎訝訥許訛論訩訟諷設訪訣證詁訶評詛識詗詐訴診詆謅詞詘詔詖譯詒誆誄試詿詩詰詼誠誅詵話誕詬詮詭詢詣諍該詳詫諢詡譸誡誣語誚誤誥誘誨誑說誦誒請諸諏諾讀諑誹課諉諛誰諗調諂諒諄誶談誼謀諶諜謊諫諧謔謁謂諤諭諼讒諮諳諺諦謎諞諝謨讜謖謝謠謗諡謙謐謹謾謫譾謬譚譖譙讕譜譎讞譴譫讖穀豶貝貞負貟貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貰貼貴貺貸貿費賀貽賊贄賈賄貲賃賂贓資賅贐賕賑賚賒賦賭齎贖賞賜贔賙賡賠賧賴賵贅賻賺賽賾贗讚贇贈贍贏贛赬趙趕趨趲躉躍蹌蹠躒踐躂蹺蹕躚躋踴躊蹤躓躑躡蹣躕躥躪躦軀車軋軌軑軔轉軛輪軟轟軲軻轤軸軹軼軤軫轢軺輕軾載輊轎輈輇輅較輒輔輛輦輩輝輥輞輬輟輜輳輻輯轀輸轡轅轄輾轆轍轔辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡適選遜遞邐邏遺遙鄧鄺鄔郵鄒鄴鄰鬱郤郟鄶鄭鄆酈鄖鄲醞醱醬釅釃釀釋裏钜鑒鑾鏨釓釔針釘釗釙釕釷釺釧釤鈒釩釣鍆釹鍚釵鈃鈣鈈鈦鈍鈔鍾鈉鋇鋼鈑鈐鑰欽鈞鎢鉤鈧鈁鈥鈄鈕鈀鈺錢鉦鉗鈷缽鈳鉕鈽鈸鉞鑽鉬鉭鉀鈿鈾鐵鉑鈴鑠鉛鉚鈰鉉鉈鉍鈹鐸鉶銬銠鉺銪鋏鋣鐃銍鐺銅鋁銱銦鎧鍘銖銑鋌銩銛鏵銓鉿銚鉻銘錚銫鉸銥鏟銃鐋銨銀銣鑄鐒鋪鋙錸鋱鏈鏗銷鎖鋰鋥鋤鍋鋯鋨鏽銼鋝鋒鋅鋶鐦鐧銳銻鋃鋟鋦錒錆鍺錯錨錡錁錕錩錫錮鑼錘錐錦鍁錈錇錟錠鍵鋸錳錙鍥鍈鍇鏘鍶鍔鍤鍬鍾鍛鎪鍠鍰鎄鍍鎂鏤鎡鏌鎮鎛鎘鑷鐫鎳鎿鎦鎬鎊鎰鎔鏢鏜鏍鏰鏞鏡鏑鏃鏇鏐鐔钁鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐶鐲鐮鐿鑔鑣鑞鑲長門閂閃閆閈閉問闖閏闈閑閎間閔閌悶閘鬧閨聞闼閩閭闓閥閣閡閫鬮閱閬闍閾閹閶鬩閿閽閻閼闡闌闃闠闊闋闔闐闒闕闞闤隊陽陰陣階際陸隴陳陘陝隉隕險隨隱隸雋難雛讎靂霧霽黴靄靚靜靨韃鞽韉韝韋韌韍韓韙韞韜韻页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颒颓颔颕颖颗题颙颚颛颜额颞颟颠颡颢颣颤颥颦颧风飏飐飑飒飓飔飕飖飗飘飙飚飞飨餍饤饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饾饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骃骄骅骆骇骈骉骊骋验骍骎骏骐骑骒骓骔骕骖骗骘骙骚骛骜骝骞骟骠骡骢骣骤骥骦骧髅髋髌鬓魇魉鱼鱽鱾鱿鲀鲁鲂鲄鲅鲆鲇鲈鲉鲊鲋鲌鲍鲎鲏鲐鲑鲒鲓鲔鲕鲖鲗鲘鲙鲚鲛鲜鲝鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲪鲫鲬鲭鲮鲯鲰鲱鲲鲳鲴鲵鲶鲷鲸鲹鲺鲻鲼鲽鲾鲿鳀鳁鳂鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳑鳒鳓鳔鳕鳖鳗鳘鳙鳛鳜鳝鳞鳟鳠鳡鳢鳣鸟鸠鸡鸢鸣鸤鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸰鸱鸲鸳鸴鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹀鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹍鹎鹏鹐鹑鹒鹓鹔鹕鹖鹗鹘鹚鹛鹜鹝鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹯鹰鹱鹲鹳鹴鹾麦麸黄黉黡黩黪黾鼋鼌鼍鼗鼹齄齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟志制咨只里系范松没尝尝闹面准钟别闲干尽脏拼]/gu;
            const hanziRegex = /\p{Script=Han}/gu;
            const cyrillicRegex = /[\u0400-\u04FF]/gu;
            const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gu;
            const vietnameseUniqueRegex = /[đĐưƯơƠăĂạảẠẢắằẳẵặẮẰẲẴẶấầẩẫậẤẦẨẪẬếềểễệẾỀỂỄỆịỉĨỈỊọỏộốồổỗỌỎỐỒỔỖớờởỡợỚỜỞỠỢụủứừửữựỤỦƯỨỪỬỮỰỵỷỹỲỴỶỸ]/gu;
            const germanCharsRegex = /[äöüßÄÖÜ]/gu;
            const spanishRegex = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/gu;
            const frenchRegex = /[àâæçéèêëïîôùûüÿœÀÂÆÇÉÈÊËÏÎÔÙÛÜŸŒ]/gu;
            const frenchUniqueRegex = /[æœçëïÿÆŒÇËÏŸ]/gu;
            const portugueseRegex = /[ãõáàâéêíóôõúüçÃÕÁÀÂÉÊÍÓÔÕÚÜÇ]/gu;
            const turkishRegex = /[çğıöşüÇĞİÖŞÜ]/gu;
            const polishRegex = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/gu;
            const arabicRegex = /[\u0600-\u06FF]/gu;
            const thaiRegex = /[\u0E00-\u0E7F]/gu;
            const devanagariRegex = /[\u0900-\u097F]/gu;
            const latinExtendedRegex = /[a-zA-ZÀ-ÿ]/gu;

            const cjkMatchRegex = this._cjkMatchRegex || (
                this._cjkMatchRegex = new RegExp(`${kanaRegex.source}|${hanziRegex.source}|${hangulRegex.source}`, "gu")
            );
            const cjkMatch = rawLyrics.match(cjkMatchRegex);

            const cyrillicMatch = rawLyrics.match(cyrillicRegex);
            const vietnameseMatch = rawLyrics.match(vietnameseRegex);
            const vietnameseUniqueMatch = rawLyrics.match(vietnameseUniqueRegex);
            const germanMatch = rawLyrics.match(germanCharsRegex);
            const spanishMatch = rawLyrics.match(spanishRegex);
            const frenchMatch = rawLyrics.match(frenchRegex);
            const frenchUniqueMatch = rawLyrics.match(frenchUniqueRegex);
            const portugueseMatch = rawLyrics.match(portugueseRegex);
            const turkishMatch = rawLyrics.match(turkishRegex);
            const polishMatch = rawLyrics.match(polishRegex);
            const arabicMatch = rawLyrics.match(arabicRegex);
            const thaiMatch = rawLyrics.match(thaiRegex);
            const hindiMatch = rawLyrics.match(devanagariRegex);
            const latinMatch = rawLyrics.match(latinExtendedRegex);

            // Arabic
            if (arabicMatch && arabicMatch.length > 5) {
                this._cacheLanguageResult(cacheKey, "ar");
                return "ar";
            }
            // Thai
            if (thaiMatch && thaiMatch.length > 5) {
                this._cacheLanguageResult(cacheKey, "th");
                return "th";
            }
            // Hindi
            if (hindiMatch && hindiMatch.length > 5) {
                this._cacheLanguageResult(cacheKey, "hi");
                return "hi";
            }
            // Russian
            if (cyrillicMatch && cyrillicMatch.length > 10) {
                this._cacheLanguageResult(cacheKey, "ru");
                return "ru";
            }

            // Vietnamese vs French
            const vietnameseUniqueCount = vietnameseUniqueMatch ? vietnameseUniqueMatch.length : 0;
            const frenchUniqueCount = frenchUniqueMatch ? frenchUniqueMatch.length : 0;
            const vietnameseCount = vietnameseMatch ? vietnameseMatch.length : 0;
            const frenchCount = frenchMatch ? frenchMatch.length : 0;

            if (vietnameseUniqueCount >= 2) {
                this._cacheLanguageResult(cacheKey, "vi");
                return "vi";
            }
            if (frenchUniqueCount >= 1 && frenchCount > 3) {
                this._cacheLanguageResult(cacheKey, "fr");
                return "fr";
            }
            if (frenchCount > 5 && vietnameseUniqueCount === 0) {
                this._cacheLanguageResult(cacheKey, "fr");
                return "fr";
            }
            if (vietnameseCount > 5 && vietnameseUniqueCount >= 1) {
                this._cacheLanguageResult(cacheKey, "vi");
                return "vi";
            }

            // Turkish
            if (turkishMatch && turkishMatch.length > 3) {
                this._cacheLanguageResult(cacheKey, "tr");
                return "tr";
            }
            // Polish
            if (polishMatch && polishMatch.length > 3) {
                this._cacheLanguageResult(cacheKey, "pl");
                return "pl";
            }
            // German
            if (germanMatch && germanMatch.length > 2) {
                this._cacheLanguageResult(cacheKey, "de");
                return "de";
            }
            // Spanish
            if (spanishMatch && spanishMatch.length > 3) {
                this._cacheLanguageResult(cacheKey, "es");
                return "es";
            }
            // Fallback French
            if (vietnameseCount > 10 && vietnameseUniqueCount === 0) {
                this._cacheLanguageResult(cacheKey, "fr");
                return "fr";
            }
            // Portuguese
            if (portugueseMatch && portugueseMatch.length > 3) {
                this._cacheLanguageResult(cacheKey, "pt");
                return "pt";
            }

            // CJK languages
            if (cjkMatch) {
                const counts = { kana: 0, hanzi: 0, simp: 0, trad: 0, hangul: 0 };

                cjkMatch.forEach((glyph) => {
                    const code = glyph.charCodeAt(0);
                    if (code >= 0xAC00 && code <= 0xD7A3) {
                        counts.hangul++;
                    } else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
                        counts.kana++;
                    } else if (hanziRegex.test(glyph)) {
                        counts.hanzi++;
                        if (simpRegex.test(glyph)) counts.simp++;
                        if (tradRegex.test(glyph)) counts.trad++;
                    }
                });

                const totalLength = cjkMatch.length;
                const kanaPercentage = counts.kana / totalLength;
                const hanziPercentage = counts.hanzi / totalLength;
                const simpPercentage = counts.simp / totalLength;
                const tradPercentage = counts.trad / totalLength;

                // Korean
                if (counts.hangul !== 0) {
                    this._cacheLanguageResult(cacheKey, "ko");
                    return "ko";
                }

                // Japanese - 설정에서 threshold 읽기
                const jaThreshold = Number(Spicetify.LocalStorage.get("ivLyrics:visual:ja-detect-threshold")) || 40;
                if (((kanaPercentage - hanziPercentage + 1) / 2) * 100 >= jaThreshold) {
                    this._cacheLanguageResult(cacheKey, "ja");
                    return "ja";
                }

                // Chinese
                const hansThreshold = Number(Spicetify.LocalStorage.get("ivLyrics:visual:hans-detect-threshold")) || 40;
                const result = ((simpPercentage - tradPercentage + 1) / 2) * 100 >= hansThreshold ? "zh-hans" : "zh-hant";
                this._cacheLanguageResult(cacheKey, result);
                return result;
            }

            // Latin-based (English)
            if (latinMatch) {
                this._cacheLanguageResult(cacheKey, "en");
                return "en";
            }

            this._cacheLanguageResult(cacheKey, null);
            return null;
        }
    };

    // window.Utils로 노출 (Extension 전용 Utils)
    window.Utils = Utils;

    // ============================================
    // API 요청/응답 추적 시스템 (Debug용)
    // ============================================
    const ApiTracker = {
        _logs: [],
        _maxLogs: 100,
        _currentTrackId: null,
        _listeners: [],

        setCurrentTrack(trackId) {
            if (this._currentTrackId !== trackId) {
                this._logs = [];
                this._currentTrackId = trackId;
                this._notifyListeners();
            }
        },

        logRequest(category, endpoint, request = null) {
            const logEntry = {
                id: Date.now() + Math.random(),
                category,
                endpoint,
                request,
                response: null,
                status: 'pending',
                startTime: Date.now(),
                endTime: null,
                duration: null,
                error: null,
                cached: false
            };

            this._logs.push(logEntry);

            if (this._logs.length > this._maxLogs) {
                this._logs.shift();
            }

            this._notifyListeners();
            return logEntry.id;
        },

        logResponse(logId, response, status = 'success', error = null, cached = false) {
            let entry = null;
            for (let i = this._logs.length - 1; i >= 0; i--) {
                if (this._logs[i].id === logId) {
                    entry = this._logs[i];
                    break;
                }
            }
            if (entry) {
                entry.response = response;
                entry.status = status;
                entry.error = error;
                entry.cached = cached;
                entry.endTime = Date.now();
                entry.duration = entry.endTime - entry.startTime;
                this._notifyListeners();
            }
        },

        logCacheHit(category, cacheKey, data) {
            const logEntry = {
                id: Date.now() + Math.random(),
                category,
                endpoint: `[CACHE] ${cacheKey}`,
                request: null,
                response: data,
                status: 'cached',
                startTime: Date.now(),
                endTime: Date.now(),
                duration: 0,
                error: null,
                cached: true
            };

            this._logs.push(logEntry);

            if (this._logs.length > this._maxLogs) {
                this._logs.shift();
            }

            this._notifyListeners();
        },

        getLogs() {
            return [...this._logs];
        },

        getLogsByCategory(category) {
            return this._logs.filter(l => l.category === category);
        },

        clear() {
            this._logs = [];
            this._notifyListeners();
        },

        addListener(callback) {
            this._listeners.push(callback);
            return () => {
                this._listeners = this._listeners.filter(l => l !== callback);
            };
        },

        _notifyListeners() {
            this._listeners.forEach(cb => {
                try { cb(this._logs); } catch (e) { }
            });
        },

        getSummary() {
            const summary = {
                total: this._logs.length,
                pending: 0,
                success: 0,
                error: 0,
                cached: 0,
                byCategory: {}
            };

            this._logs.forEach(log => {
                if (log.status === 'pending') summary.pending++;
                else if (log.status === 'success') summary.success++;
                else if (log.status === 'error') summary.error++;
                if (log.cached) summary.cached++;

                if (!summary.byCategory[log.category]) {
                    summary.byCategory[log.category] = { total: 0, success: 0, error: 0, cached: 0 };
                }
                summary.byCategory[log.category].total++;
                if (log.status === 'success') summary.byCategory[log.category].success++;
                if (log.status === 'error') summary.byCategory[log.category].error++;
                if (log.cached) summary.byCategory[log.category].cached++;
            });

            return summary;
        }
    };

    // 전역 접근 가능하도록 window에 등록
    window.ApiTracker = ApiTracker;

    // ============================================
    // IndexedDB 기반 로컬 캐시 시스템
    // ============================================
    const LyricsCache = {
        DB_NAME: 'ivLyricsCache',
        DB_VERSION: 6,

        EXPIRY: {
            lyrics: 7,
            translation: 30,
            phonetic: 30,
            metadata: 30,
            sync: 7,
            youtube: 7,
            tmi: 30
        },

        _db: null,
        _dbPromise: null,

        async _openDB() {
            if (this._db) return this._db;
            if (this._dbPromise) return this._dbPromise;

            this._dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                request.onerror = () => {
                    console.error('[LyricsCache] Failed to open database:', request.error);
                    this._dbPromise = null;
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this._db = request.result;
                    resolve(this._db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    const oldVersion = event.oldVersion;

                    if (oldVersion < 4 && db.objectStoreNames.contains('lyrics')) {
                        db.deleteObjectStore('lyrics');
                    }
                    if (!db.objectStoreNames.contains('lyrics')) {
                        const lyricsStore = db.createObjectStore('lyrics', { keyPath: 'cacheKey' });
                        lyricsStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                        lyricsStore.createIndex('trackId', 'trackId', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('translations')) {
                        const transStore = db.createObjectStore('translations', { keyPath: 'cacheKey' });
                        transStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('youtube')) {
                        const ytStore = db.createObjectStore('youtube', { keyPath: 'trackId' });
                        ytStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('metadata')) {
                        const metaStore = db.createObjectStore('metadata', { keyPath: 'cacheKey' });
                        metaStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('sync')) {
                        const syncStore = db.createObjectStore('sync', { keyPath: 'trackId' });
                        syncStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                    }

                    if (!db.objectStoreNames.contains('tmi')) {
                        const tmiStore = db.createObjectStore('tmi', { keyPath: 'cacheKey' });
                        tmiStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                        tmiStore.createIndex('trackId', 'trackId', { unique: false });
                    }
                };
            });

            return this._dbPromise;
        },

        _isExpired(cachedAt, type) {
            if (!cachedAt) return true;
            const expiryDays = this.EXPIRY[type] || 7;
            const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
            return Date.now() - cachedAt > expiryMs;
        },

        _getLyricsKey(trackId, provider) {
            return `${trackId}:${provider || 'unknown'}`;
        },

        async getLyrics(trackId, provider) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('lyrics', 'readonly');
                const store = tx.objectStore('lyrics');
                const cacheKey = this._getLyricsKey(trackId, provider);

                const result = await new Promise((resolve, reject) => {
                    const request = store.get(cacheKey);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                if (result && !this._isExpired(result.cachedAt, 'lyrics')) {
                    return result.data;
                }

                return null;
            } catch (error) {
                console.error('[LyricsCache] getLyrics error:', error);
                return null;
            }
        },

        async setLyrics(trackId, provider, data) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('lyrics', 'readwrite');
                const store = tx.objectStore('lyrics');
                const cacheKey = this._getLyricsKey(trackId, provider);

                store.put({
                    cacheKey,
                    trackId,
                    provider,
                    data,
                    cachedAt: Date.now()
                });

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] setLyrics error:', error);
                return false;
            }
        },

        _getTranslationKey(trackId, lang, isPhonetic, provider) {
            const providerSuffix = provider ? `:${provider}` : '';
            return `${trackId}:${lang}:${isPhonetic ? 'phonetic' : 'translation'}${providerSuffix}`;
        },

        async getTranslation(trackId, lang, isPhonetic = false, provider = null) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('translations', 'readonly');
                const store = tx.objectStore('translations');
                const cacheKey = this._getTranslationKey(trackId, lang, isPhonetic, provider);

                const result = await new Promise((resolve, reject) => {
                    const request = store.get(cacheKey);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                const type = isPhonetic ? 'phonetic' : 'translation';
                if (result && !this._isExpired(result.cachedAt, type)) {
                    return result.data;
                }

                return null;
            } catch (error) {
                console.error('[LyricsCache] getTranslation error:', error);
                return null;
            }
        },

        async setTranslation(trackId, lang, isPhonetic, data, provider = null) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('translations', 'readwrite');
                const store = tx.objectStore('translations');
                const cacheKey = this._getTranslationKey(trackId, lang, isPhonetic, provider);

                store.put({
                    cacheKey,
                    trackId,
                    lang,
                    isPhonetic,
                    provider,
                    data,
                    cachedAt: Date.now()
                });

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] setTranslation error:', error);
                return false;
            }
        },

        async getMetadata(trackId, lang) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('metadata', 'readonly');
                const store = tx.objectStore('metadata');
                const cacheKey = `${trackId}:${lang}`;

                const result = await new Promise((resolve, reject) => {
                    const request = store.get(cacheKey);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                if (result && !this._isExpired(result.cachedAt, 'metadata')) {
                    return result.data;
                }

                return null;
            } catch (error) {
                console.error('[LyricsCache] getMetadata error:', error);
                return null;
            }
        },

        async setMetadata(trackId, lang, data) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('metadata', 'readwrite');
                const store = tx.objectStore('metadata');
                const cacheKey = `${trackId}:${lang}`;

                store.put({
                    cacheKey,
                    trackId,
                    lang,
                    data,
                    cachedAt: Date.now()
                });

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] setMetadata error:', error);
                return false;
            }
        },

        async getYouTube(trackId) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('youtube', 'readonly');
                const store = tx.objectStore('youtube');

                const result = await new Promise((resolve, reject) => {
                    const request = store.get(trackId);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                if (result && !this._isExpired(result.cachedAt, 'youtube')) {
                    return result.data;
                }

                return null;
            } catch (error) {
                console.error('[LyricsCache] getYouTube error:', error);
                return null;
            }
        },

        async setYouTube(trackId, data) {
            try {
                const db = await this._openDB();
                const tx = db.transaction('youtube', 'readwrite');
                const store = tx.objectStore('youtube');

                store.put({
                    trackId,
                    data,
                    cachedAt: Date.now()
                });

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] setYouTube error:', error);
                return false;
            }
        },

        async getSync(trackId) {
            try {
                const db = await this._openDB();

                if (!db.objectStoreNames.contains('sync')) {
                    return null;
                }

                const tx = db.transaction('sync', 'readonly');
                const store = tx.objectStore('sync');

                const result = await new Promise((resolve, reject) => {
                    const request = store.get(trackId);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                if (result && !this._isExpired(result.cachedAt, 'sync')) {
                    return result.data;
                }

                return null;
            } catch (error) {
                console.error('[LyricsCache] getSync error:', error);
                return null;
            }
        },

        async setSync(trackId, data) {
            try {
                const db = await this._openDB();

                if (!db.objectStoreNames.contains('sync')) {
                    return false;
                }

                const tx = db.transaction('sync', 'readwrite');
                const store = tx.objectStore('sync');

                store.put({
                    trackId,
                    data,
                    cachedAt: Date.now()
                });

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] setSync error:', error);
                return false;
            }
        },

        async deleteSync(trackId) {
            try {
                const db = await this._openDB();

                if (!db.objectStoreNames.contains('sync')) {
                    return false;
                }

                const tx = db.transaction('sync', 'readwrite');
                const store = tx.objectStore('sync');

                store.delete(trackId);

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] deleteSync error:', error);
                return false;
            }
        },

        async getTMI(trackId, lang) {
            try {
                const db = await this._openDB();

                if (!db.objectStoreNames.contains('tmi')) {
                    return null;
                }

                const tx = db.transaction('tmi', 'readonly');
                const store = tx.objectStore('tmi');
                const cacheKey = `${trackId}:${lang}`;

                const result = await new Promise((resolve, reject) => {
                    const request = store.get(cacheKey);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                if (result && !this._isExpired(result.cachedAt, 'tmi')) {
                    return result.data;
                }

                return null;
            } catch (error) {
                console.error('[LyricsCache] getTMI error:', error);
                return null;
            }
        },

        async setTMI(trackId, lang, data) {
            try {
                const db = await this._openDB();

                if (!db.objectStoreNames.contains('tmi')) {
                    return false;
                }

                const tx = db.transaction('tmi', 'readwrite');
                const store = tx.objectStore('tmi');
                const cacheKey = `${trackId}:${lang}`;

                store.put({
                    cacheKey,
                    trackId,
                    lang,
                    data,
                    cachedAt: Date.now()
                });

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });

                return true;
            } catch (error) {
                console.error('[LyricsCache] setTMI error:', error);
                return false;
            }
        },

        async cleanup() {
            try {
                const db = await this._openDB();
                const stores = ['lyrics', 'translations', 'youtube', 'metadata', 'sync', 'tmi'];

                for (const storeName of stores) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        continue;
                    }

                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);

                    const request = store.openCursor();
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            const type = storeName === 'translations'
                                ? (cursor.value.isPhonetic ? 'phonetic' : 'translation')
                                : storeName;

                            if (this._isExpired(cursor.value.cachedAt, type)) {
                                cursor.delete();
                            }
                            cursor.continue();
                        }
                    };
                }

                serviceDebug('[LyricsCache] Cleanup completed');
            } catch (error) {
                console.error('[LyricsCache] cleanup error:', error);
            }
        },

        async clearTranslationForTrack(trackId) {
            try {
                const db = await this._openDB();

                return new Promise((resolve, reject) => {
                    const transTx = db.transaction('translations', 'readwrite');
                    const transStore = transTx.objectStore('translations');
                    const transRequest = transStore.openCursor();

                    transRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            if (cursor.value.trackId === trackId) {
                                cursor.delete();
                            }
                            cursor.continue();
                        }
                    };

                    transTx.oncomplete = () => {
                        resolve(true);
                    };
                    transTx.onerror = () => reject(transTx.error);
                });
            } catch (error) {
                console.error('[LyricsCache] clearTranslationForTrack error:', error);
                return false;
            }
        },

        async clearTrack(trackId) {
            try {
                const db = await this._openDB();
                const deletePromises = [];

                // 가사 삭제
                deletePromises.push(new Promise((resolve, reject) => {
                    const lyricsTx = db.transaction('lyrics', 'readwrite');
                    const lyricsStore = lyricsTx.objectStore('lyrics');
                    const lyricsIndex = lyricsStore.index('trackId');
                    const lyricsRequest = lyricsIndex.openCursor(IDBKeyRange.only(trackId));
                    lyricsRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            cursor.delete();
                            cursor.continue();
                        }
                    };
                    lyricsTx.oncomplete = () => resolve();
                    lyricsTx.onerror = () => reject(lyricsTx.error);
                }));

                // 번역 삭제
                deletePromises.push(new Promise((resolve, reject) => {
                    const transTx = db.transaction('translations', 'readwrite');
                    const transStore = transTx.objectStore('translations');
                    const transRequest = transStore.openCursor();
                    transRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            if (cursor.value.trackId === trackId) {
                                cursor.delete();
                            }
                            cursor.continue();
                        }
                    };
                    transTx.oncomplete = () => resolve();
                    transTx.onerror = () => reject(transTx.error);
                }));

                // YouTube 삭제
                deletePromises.push(new Promise((resolve, reject) => {
                    const ytTx = db.transaction('youtube', 'readwrite');
                    ytTx.objectStore('youtube').delete(trackId);
                    ytTx.oncomplete = () => resolve();
                    ytTx.onerror = () => reject(ytTx.error);
                }));

                // 메타데이터 삭제
                deletePromises.push(new Promise((resolve, reject) => {
                    const metaTx = db.transaction('metadata', 'readwrite');
                    const metaStore = metaTx.objectStore('metadata');
                    const metaRequest = metaStore.openCursor();
                    metaRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            if (cursor.value.trackId === trackId) {
                                cursor.delete();
                            }
                            cursor.continue();
                        }
                    };
                    metaTx.oncomplete = () => resolve();
                    metaTx.onerror = () => reject(metaTx.error);
                }));

                // Sync 삭제
                if (db.objectStoreNames.contains('sync')) {
                    deletePromises.push(new Promise((resolve, reject) => {
                        const syncTx = db.transaction('sync', 'readwrite');
                        syncTx.objectStore('sync').delete(trackId);
                        syncTx.oncomplete = () => resolve();
                        syncTx.onerror = () => reject(syncTx.error);
                    }));
                }

                // TMI 삭제
                if (db.objectStoreNames.contains('tmi')) {
                    deletePromises.push(new Promise((resolve, reject) => {
                        const tmiTx = db.transaction('tmi', 'readwrite');
                        const tmiStore = tmiTx.objectStore('tmi');
                        const tmiIndex = tmiStore.index('trackId');
                        const tmiRequest = tmiIndex.openCursor(IDBKeyRange.only(trackId));
                        tmiRequest.onsuccess = (event) => {
                            const cursor = event.target.result;
                            if (cursor) {
                                cursor.delete();
                                cursor.continue();
                            }
                        };
                        tmiTx.oncomplete = () => resolve();
                        tmiTx.onerror = () => reject(tmiTx.error);
                    }));
                }

                await Promise.all(deletePromises);
                return true;
            } catch (error) {
                console.error('[LyricsCache] clearTrack error:', error);
                return false;
            }
        },

        async clearAll() {
            try {
                const db = await this._openDB();
                const stores = ['lyrics', 'translations', 'youtube', 'metadata', 'sync', 'tmi'];

                const clearPromises = stores.map(storeName => {
                    return new Promise((resolve, reject) => {
                        if (!db.objectStoreNames.contains(storeName)) {
                            resolve();
                            return;
                        }
                        const tx = db.transaction(storeName, 'readwrite');
                        tx.objectStore(storeName).clear();
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    });
                });

                await Promise.all(clearPromises);
                return true;
            } catch (error) {
                console.error('[LyricsCache] clearAll error:', error);
                return false;
            }
        },

        async getStats() {
            try {
                const db = await this._openDB();
                const stores = ['lyrics', 'translations', 'youtube', 'metadata', 'sync', 'tmi'];
                const stats = {};

                for (const storeName of stores) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        stats[storeName] = 0;
                        continue;
                    }
                    const tx = db.transaction(storeName, 'readonly');
                    const store = tx.objectStore(storeName);

                    stats[storeName] = await new Promise((resolve, reject) => {
                        const request = store.count();
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                return stats;
            } catch (error) {
                console.error('[LyricsCache] getStats error:', error);
                return null;
            }
        }
    };

    // 시작 시 만료된 캐시 정리 (5초 후 백그라운드에서)
    setTimeout(() => LyricsCache.cleanup(), 5000);

    // 전역에 등록
    window.LyricsCache = LyricsCache;


    // ============================================
    // SyncDataService - 커뮤니티 싱크 데이터 서비스
    // 가사 없이 타이밍 정보만 저장/적용하는 시스템
    // ============================================
    const SyncDataService = (() => {
        const API_BASE = 'https://lyrics.api.ivl.is';
        const _syncDataCache = new Map();
        const _inflightRequests = new Map(); // 진행 중인 요청 추적
        const _fullyLoadedTracks = new Set(); // 전체 목록이 로드된 트랙 ID

        /**
         * 사용 가능한 sync-data provider 목록 조회
         * @param {string} trackId - Spotify Track ID
         * @returns {Promise<Array>} - provider 목록 [{ provider, createdAt, updatedAt }]
         */
        async function getAvailableProviders(trackId) {
            const cacheKey = `${trackId}:providers`;

            // 캐시 확인
            if (_syncDataCache.has(cacheKey)) {
                return _syncDataCache.get(cacheKey);
            }

            _syncDataCache.set(cacheKey, []);
            return [];
        }

        /**
         * 특정 provider의 싱크 데이터 조회
         * @param {string} trackId - Spotify Track ID
         * @param {string} provider - 가사 provider
         * @returns {Promise<Object|null>} - 싱크 데이터 또는 null
         */
        async function getSyncData(trackId, provider = null) {
            if (!provider) {
                // provider 미지정 시 - 하위 호환성: 사용 가능한 첫 번째 provider의 데이터 반환
                const providers = await getAvailableProviders(trackId);
                if (providers.length === 0) return null;
                provider = providers[0].provider;
            }

            const specificKey = `${trackId}:${provider}`;

            // 캐시 확인
            if (_syncDataCache.has(specificKey)) {
                return _syncDataCache.get(specificKey);
            }

            // API 직접 요청
            try {
                // In-flight request check
                if (_inflightRequests.has(specificKey)) {
                    return _inflightRequests.get(specificKey);
                }

                const fetchPromise = (async () => {
                    // provider가 legacy인 경우 (Spicetify-custom-apps 호환)
                    const queryProvider = provider === 'legacy' ? 'spotify' : provider;
                    const response = await fetch(`${API_BASE}/lyrics/sync-data?trackId=${trackId}&provider=${queryProvider}`);

                    if (!response.ok) {
                        if (response.status === 404) return null;
                        throw new Error(`API Error: ${response.status}`);
                    }

                    const result = await response.json();

                    // 결과가 있고 success가 true이거나 데이터가 직접 반환된 경우
                    const data = result.data || result;

                    if (data) {
                        // 결과 구조 정규화 - API 응답 구조: data.syncData.lines
                        let lines = null;

                        if (Array.isArray(data)) {
                            lines = data;
                        } else if (Array.isArray(data.lines)) {
                            lines = data.lines;
                        } else if (data.syncData && Array.isArray(data.syncData.lines)) {
                            lines = data.syncData.lines;
                        }

                        if (!lines) return null;

                        const syncData = {
                            trackId,
                            provider,
                            syncData: { lines },
                            contributors: data.contributors || [],
                            createdAt: data.createdAt || null,
                            updatedAt: data.updatedAt || null
                        };
                        _syncDataCache.set(specificKey, syncData);
                        return syncData;
                    }
                    return null;
                })();

                _inflightRequests.set(specificKey, fetchPromise);
                const result = await fetchPromise;
                _inflightRequests.delete(specificKey);
                return result;
            } catch (e) {
                console.warn(`[SyncDataService] Failed to fetch sync data for ${trackId}:${provider}`, e);
                _inflightRequests.delete(specificKey);
                return null;
            }
        }

        /**
         * 해당 provider에 sync-data가 있는지 확인
         * @param {string} trackId - Spotify Track ID
         * @param {string} provider - 가사 provider (예: spotify-abc, lrclib)
         * @returns {Promise<boolean>}
         */
        async function hasSyncData(trackId, provider) {
            const providers = await getAvailableProviders(trackId);
            return providers.some(p => p.provider === provider);
        }

        function clearCache(trackId) {
            if (trackId) {
                _syncDataCache.delete(trackId);
                // trackId 관련 모든 캐시 삭제
                for (const key of _syncDataCache.keys()) {
                    if (key.startsWith(`${trackId}:`)) {
                        _syncDataCache.delete(key);
                    }
                }
                _fullyLoadedTracks.delete(trackId);
            } else {
                _syncDataCache.clear();
                _fullyLoadedTracks.clear();
            }
        }

        /**
         * 싱크 데이터 제출
         * @param {string} trackId - Spotify Track ID
         * @param {string} provider - 가사 출처 ('spotify', 'lrclib')
         * @param {Object} syncData - 싱크 데이터 { lines: [...] }
         * @returns {Promise<Object>} - 제출 결과
         */
	        async function submitSyncData(trackId, provider, syncData) {
	            const userHash = getUserHash();
	            const authToken = Spicetify.LocalStorage.get("ivLyrics:auth-token");

	            const response = await fetch(`${API_BASE}/lyrics/sync-data`, {
	                method: 'POST',
	                headers: {
	                    "Content-Type": "application/json",
	                    "User-Agent": `spicetify v${Spicetify.Config.version}`,
	                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
	                },
	                body: JSON.stringify({
	                    trackId,
                    provider,
                    syncData,
                    userHash
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to submit sync data');
            }

            clearCache(trackId);
            return result;
        }

        /**
         * 싱크 데이터를 가사에 적용하여 karaoke 형식으로 변환
         * @param {Array} lyrics - 원본 가사 라인 배열 [{text: "..."}, ...]
         * @param {Object} syncData - 싱크 데이터 { provider, syncData: { lines: [...] } }
         * @returns {Array} - karaoke 형식의 가사
         */
        function applySyncDataToLyrics(lyrics, syncData) {
            if (!lyrics || !syncData || !syncData.syncData || !syncData.syncData.lines) {
                return null;
            }

            const syncLines = syncData.syncData.lines;

            // 전체 가사 텍스트를 하나로 합침 (줄바꿈 없이 - SyncDataCreator와 동일하게)
            // SyncDataCreator에서는 각 줄의 글자 수만 계산하고 줄바꿈은 포함하지 않음
            // 중요 1: SyncDataCreator는 Array.from()으로 유니코드 코드 포인트 기준 인덱스를 사용하므로
            // 여기서도 동일하게 Array.from()을 사용해야 특수문자(서로게이트 페어, 결합 문자 등)가 포함된 경우에도 정확한 인덱싱이 가능함
            // 중요 2: SyncDataCreator에서는 filter(t => t.trim().length > 0)로 빈 줄/공백 줄을 제외하므로
            // 여기서도 동일하게 필터링해야 인덱스가 맞음
            // 중요 3: NFD(결합 문자) vs NFC(합성 문자) 정규화 차이로 인한 인덱스 불일치 방지
            // 예: "é"가 NFD에서는 "e" + 결합 액센트로 2개 코드포인트, NFC에서는 1개 코드포인트
            // SyncDataCreator와 동일하게 NFC로 정규화해야 함
            const fullTextChars = lyrics
                .filter(line => (line.text || '').trim().length > 0)
                .map(line => Array.from((line.text || '').normalize('NFC')))
                .flat();

            const result = [];

            for (let i = 0; i < syncLines.length; i++) {
                const lineData = syncLines[i];
                const nextLineData = syncLines[i + 1];

                // 해당 범위의 텍스트 추출 (유니코드 문자 배열에서 slice 사용)
                const lineText = fullTextChars.slice(lineData.start, lineData.end + 1).join('');

                // 라인 시작/종료 시간 계산 (일단 다음 줄 시작 전까지로 잡지만, 아래에서 조정함)
                const lineStartTime = Math.round(lineData.chars[0] * 1000);
                let lineEndTime = nextLineData
                    ? Math.round(nextLineData.chars[0] * 1000)
                    : Math.round(lineData.chars[lineData.chars.length - 1] * 1000) + 2000;

                // 평균 글자 지속 시간 계산 (초 단위)
                const lineDuration = (nextLineData
                    ? nextLineData.chars[0]
                    : lineData.chars[lineData.chars.length - 1] + 1) - lineData.chars[0];
                const avgCharDuration = Math.max(0.2, lineDuration / Math.max(1, lineData.chars.length));

                // 마지막 글자의 자연스러운 최대 지속 시간 (평균의 2.5배 또는 최대 1.5초)
                // 너무 짧게 끊기지 않도록 최소 0.5초는 보장
                const lastCharMaxDuration = Math.max(0.5, Math.min(1.5, avgCharDuration * 2.5));

                // 각 글자별 syllable 생성
                const syllables = [];
                const chars = Array.from(lineText); // 유니코드 문자 지원

                for (let j = 0; j < lineData.chars.length && j < chars.length; j++) {
                    const charStartTime = Math.round(lineData.chars[j] * 1000);
                    let charEndTime;

                    if (j < lineData.chars.length - 1) {
                        charEndTime = Math.round(lineData.chars[j + 1] * 1000);
                    } else {
                        // 마지막 글자: 다음 줄 시작 시간과 자연스러운 종료 시간 중 더 빠른 것 선택
                        const naturalEndTime = Math.round((lineData.chars[j] + lastCharMaxDuration) * 1000);
                        charEndTime = Math.min(lineEndTime, naturalEndTime);

                        // 라인 전체 종료 시간도 이에 맞춰 조정 (너무 길게 늘어지는 것 방지)
                        lineEndTime = charEndTime;
                    }

                    syllables.push({
                        text: chars[j],
                        startTime: charStartTime,
                        endTime: charEndTime
                    });
                }

                result.push({
                    startTime: lineStartTime,
                    endTime: lineEndTime,
                    text: lineText,
                    syllables
                });
            }

            return result;
        }

        /**
         * sync-data에서 일반 싱크 가사 생성 (karaoke -> synced 변환)
         * @param {Array} karaoke - karaoke 형식 가사
         * @returns {Array} - synced 형식 가사
         */
        function convertKaraokeToSynced(karaoke) {
            if (!karaoke || !Array.isArray(karaoke)) return null;

            return karaoke.map(line => ({
                startTime: line.startTime,
                text: line.text
            }));
        }

        return {
            getSyncData,
            getAvailableProviders,
            hasSyncData,
            submitSyncData,
            applySyncDataToLyrics,
            convertKaraokeToSynced,
            clearCache
        };
    })();

    window.SyncDataService = SyncDataService;



    // ============================================
    // LyricsService - 통합 API
    // 다른 모듈에서 가사/번역/발음을 가져오는 통합 인터페이스
    // ============================================
    const LyricsService = {
        // 버전 정보
        version: "1.0.0",

        // 캐시 접근
        cache: LyricsCache,

        // API 트래커 접근
        tracker: ApiTracker,

        // 언어 감지 (Extension 내 Utils에서 직접 참조)
        detectLanguage(lyrics) {
            return Utils.detectLanguage(lyrics);
        },

        /**
         * 사용자 해시 가져오기 (없으면 생성)
         * Utils에서 이동됨
         */
        getUserHash() {

            let hash = Spicetify.LocalStorage.get("ivLyrics:user-hash");
            if (!hash) {
                // Generate UUID
                hash = crypto.randomUUID ? crypto.randomUUID() :
                    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                        const r = Math.random() * 16 | 0;
                        const v = c === 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
                Spicetify.LocalStorage.set("ivLyrics:user-hash", hash);
            }
            return hash;
        },



        /**
         * 여러 제공자에서 순차적으로 가사 가져오기
         * @param {Object} info - 트랙 정보
         * @param {string[]} providerOrder - (deprecated) LyricsAddonManager의 순서 사용
         * @param {number} mode - (deprecated) 가사 모드
         * @returns {Promise<Object>} - 가사 결과
         */
        async getLyricsFromProviders(info, providerOrder = [], mode = 1) {
            // LyricsAddonManager를 통해 가사 가져오기
            if (window.LyricsAddonManager) {
                const result = await window.LyricsAddonManager.getLyrics(info);
                return result;
            }

            return { error: "No lyrics providers registered", uri: info.uri };
        },

        /**
         * 싱크 데이터 서비스 접근
         */
        syncData: SyncDataService,

        /**
         * 캐시된 가사 가져오기
         * @param {string} trackId - 트랙 ID
         * @param {string} provider - 제공자 이름
         * @returns {Promise<Object|null>} - 캐시된 가사 또는 null
         */
        async getCachedLyrics(trackId, provider = 'spotify') {
            return await LyricsCache.getLyrics(trackId, provider);
        },

        /**
         * 가사 캐시 저장
         * @param {string} trackId - 트랙 ID
         * @param {string} provider - 제공자 이름
         * @param {Object} data - 가사 데이터
         * @returns {Promise<boolean>}
         */
        async cacheLyrics(trackId, provider, data) {
            return await LyricsCache.setLyrics(trackId, provider, data);
        },

        /**
         * 번역 가져오기 (캐시 우선)
         * @param {string} trackId - 트랙 ID
         * @param {string} lang - 언어 코드
         * @param {boolean} isPhonetic - 발음 여부
         * @param {string} provider - 가사 제공자
         * @returns {Promise<Object|null>}
         */
        async getTranslation(trackId, lang, isPhonetic = false, provider = null) {
            return await LyricsCache.getTranslation(trackId, lang, isPhonetic, provider);
        },

        /**
         * 번역 저장
         * @param {string} trackId - 트랙 ID
         * @param {string} lang - 언어 코드
         * @param {boolean} isPhonetic - 발음 여부
         * @param {Object} data - 번역 데이터
         * @param {string} provider - 가사 제공자
         * @returns {Promise<boolean>}
         */
        async cacheTranslation(trackId, lang, isPhonetic, data, provider = null) {
            return await LyricsCache.setTranslation(trackId, lang, isPhonetic, data, provider);
        },

        /**
         * 특정 트랙의 모든 캐시 삭제
         * @param {string} trackId - 트랙 ID
         * @returns {Promise<boolean>}
         */
        async clearTrackCache(trackId) {
            return await LyricsCache.clearTrack(trackId);
        },

        /**
         * 특정 트랙의 번역 캐시만 삭제
         * @param {string} trackId - 트랙 ID
         * @returns {Promise<boolean>}
         */
        async clearTranslationCache(trackId) {
            return await LyricsCache.clearTranslationForTrack(trackId);
        },

        /**
         * 모든 캐시 삭제
         * @returns {Promise<boolean>}
         */
        async clearAllCache() {
            return await LyricsCache.clearAll();
        },

        /**
         * 캐시 통계 가져오기
         * @returns {Promise<Object>}
         */
        async getCacheStats() {
            return await LyricsCache.getStats();
        },

        /**
         * 현재 재생 중인 트랙 정보 가져오기
         * @returns {Object|null}
         */
        getCurrentTrackInfo() {
            const item = Spicetify.Player.data?.item;
            if (!item) return null;

            return {
                uri: item.uri,
                title: item.name,
                artist: item.artists?.map(a => a.name).join(', ') || '',
                album: item.album?.name || '',
                duration: item.duration?.milliseconds || 0,
                trackId: item.uri?.split(':')[2]
            };
        },

        /**
         * 이벤트 발생 (가사 로드 완료 등)
         * @param {string} eventName - 이벤트 이름
         * @param {Object} data - 이벤트 데이터
         */
        emit(eventName, data) {
            window.dispatchEvent(new CustomEvent(`LyricsService:${eventName}`, { detail: data }));
        },

        /**
         * 이벤트 리스너 등록
         * @param {string} eventName - 이벤트 이름
         * @param {Function} callback - 콜백 함수
         * @returns {Function} - 리스너 해제 함수
         */
        on(eventName, callback) {
            const handler = (e) => callback(e.detail);
            window.addEventListener(`LyricsService:${eventName}`, handler);
            return () => window.removeEventListener(`LyricsService:${eventName}`, handler);
        },

        /**
         * 가사와 발음/번역을 한 번에 가져오기 (통합 API)
         * @param {Object} info - 트랙 정보 { uri, title, artist, duration }
         * @param {Object} options - 옵션
         * @param {string} options.displayMode1 - 첫 번째 표시 모드 (발음 등)
         * @param {string} options.displayMode2 - 두 번째 표시 모드 (번역 등)
         * @param {boolean} options.sendToOverlay - 오버레이로 전송 여부 (기본: true)
         * @param {string[]} options.providerOrder - provider 순서
         * @returns {Promise<Object>} - { lyrics, provider, error }
         */
        async getFullLyrics(info, options = {}) {
            const {
                displayMode1 = null,
                displayMode2 = null,
                sendToOverlay = true
            } = options;

            try {
                // 1. 가사 가져오기 (LyricsAddonManager 사용)
                const lyricsResult = await this.getLyricsFromProviders(info);

                if (lyricsResult.error) {
                    // 가사 없음 - 오버레이에 트랙 정보만 전송
                    if (sendToOverlay && window.OverlaySender?.sendLyrics) {
                        await window.OverlaySender.sendLyrics(
                            { uri: info.uri, title: info.title, artist: info.artist },
                            [],
                            true
                        );
                    }
                    if (window.lyricsHelperSender?.sendLyrics) {
                        await window.lyricsHelperSender.sendLyrics(
                            { uri: info.uri, title: info.title, artist: info.artist },
                            [],
                            true
                        );
                    }

                    return { lyrics: [], provider: null, error: lyricsResult.error };
                }

                // 2. 가사 선택 (synced, karaoke, unsynced 순)
                let lyrics = lyricsResult.synced || lyricsResult.karaoke || lyricsResult.unsynced || [];
                const provider = lyricsResult.provider;

                if (lyrics.length === 0) {
                    if (sendToOverlay && window.OverlaySender?.sendLyrics) {
                        await window.OverlaySender.sendLyrics(
                            { uri: info.uri, title: info.title, artist: info.artist },
                            [],
                            true
                        );
                    }
                    if (window.lyricsHelperSender?.sendLyrics) {
                        await window.lyricsHelperSender.sendLyrics(
                            { uri: info.uri, title: info.title, artist: info.artist },
                            [],
                            true
                        );
                    }
                    return { lyrics: [], provider, error: "No lyrics" };
                }

                // 3. endTime 계산 (없으면 다음 라인의 startTime 사용)
                lyrics = lyrics.map((line, idx, arr) => {
                    if (!line.endTime && idx < arr.length - 1) {
                        return { ...line, endTime: arr[idx + 1].startTime };
                    }
                    return line;
                });

                // 4. 언어 감지 및 displayMode 결정
                let mode1 = displayMode1;
                let mode2 = displayMode2;

                // 언어 감지 (Extension 내 Utils 사용)
                const detectedLanguage = Utils.detectLanguage(lyrics);
                let friendlyLanguage = null;

                if (detectedLanguage) {
                    try {
                        friendlyLanguage = new Intl.DisplayNames(["en"], { type: "language" })
                            .of(detectedLanguage.split("-")[0])
                            ?.toLowerCase();
                    } catch (e) {
                        // ignore
                    }
                }

                // 설정을 LocalStorage에서 직접 읽기
                const translationProvider = Spicetify.LocalStorage.get("ivLyrics:visual:translate:translated-lyrics-source") || "auto";
                const modeKey = friendlyLanguage || "gemini";

                // 설정 키: translation-mode:japanese, translation-mode-2:japanese 등
                if (mode1 === null) {
                    mode1 = Spicetify.LocalStorage.get(`ivLyrics:visual:translation-mode:${modeKey}`) || "none";
                }
                if (mode2 === null) {
                    mode2 = Spicetify.LocalStorage.get(`ivLyrics:visual:translation-mode-2:${modeKey}`) || "none";
                }

                serviceDebug('[LyricsService] 언어 감지:', { detectedLanguage, friendlyLanguage, modeKey, mode1, mode2 });

                // 5. 발음/번역 요청 (설정에 따라)
                const needsTranslation = mode1 !== "none" || mode2 !== "none";

                if (needsTranslation && window.Translator?.callGemini) {
                    serviceDebug('[LyricsService] 발음/번역 요청:', { mode1, mode2 });

                    try {
                        // Gemini API를 통한 발음/번역 요청
                        const lyricsText = lyrics.map(l => l.text || '').join('\n');

                        // 발음 요청 (mode1 = gemini_romaji)
                        let pronResult = null;
                        if (mode1 && mode1 !== 'none' && String(mode1).startsWith('gemini')) {
                            const wantPhonetic = mode1 === 'gemini_romaji';
                            const response = await window.Translator.callGemini({
                                trackId: info.uri?.split(':')[2],
                                artist: info.artist,
                                title: info.title,
                                text: lyricsText,
                                wantSmartPhonetic: wantPhonetic,
                                provider: provider
                            });
                            pronResult = wantPhonetic ? response.phonetic : response.translation;
                        }

                        // 번역 요청 (mode2 = gemini_ko 등)
                        let transResult = null;
                        if (mode2 && mode2 !== 'none' && String(mode2).startsWith('gemini')) {
                            const wantPhonetic = mode2 === 'gemini_romaji';
                            const response = await window.Translator.callGemini({
                                trackId: info.uri?.split(':')[2],
                                artist: info.artist,
                                title: info.title,
                                text: lyricsText,
                                wantSmartPhonetic: wantPhonetic,
                                provider: provider
                            });
                            transResult = wantPhonetic ? response.phonetic : response.translation;
                        }

                        // 결과 병합
                        if (pronResult || transResult) {
                            const pronLines = Array.isArray(pronResult) ? pronResult : (pronResult ? pronResult.split('\n') : []);
                            const transLines = Array.isArray(transResult) ? transResult : (transResult ? transResult.split('\n') : []);

                            lyrics = lyrics.map((line, idx) => {
                                const originalText = line.text || '';
                                const pronText = pronLines[idx]?.trim() || null;
                                const transText = transLines[idx]?.trim() || null;

                                // Determine the final original text.
                                // If pronText exists, the current 'text' is the original.
                                // If pronText doesn't exist, but line.originalText exists, use that.
                                // Otherwise, the current 'text' is the original.
                                const finalOriginal = pronText ? originalText : (line.originalText || originalText);

                                return {
                                    ...line,
                                    originalText: finalOriginal, // The original text before any phonetic/translation
                                    text: pronText || originalText, // The primary displayed text (phonetic or original)
                                    text2: transText, // The secondary displayed text (translation)
                                    translation: transText, // For compatibility
                                    translationText: transText // For compatibility
                                };
                            });

                            serviceDebug('[LyricsService] 발음/번역 완료');
                        }
                    } catch (translationError) {
                        console.warn('[LyricsService] 발음/번역 실패:', translationError);
                        // 발음/번역 실패해도 원본 가사는 반환
                    }
                }

                // 6. 오버레이 전송
                if (sendToOverlay && window.OverlaySender?.sendLyrics) {
                    await window.OverlaySender.sendLyrics(
                        { uri: info.uri, title: info.title, artist: info.artist },
                        lyrics,
                        true
                    );
                }
                // 헬퍼 전송
                if (window.lyricsHelperSender?.sendLyrics) {
                    await window.lyricsHelperSender.sendLyrics(
                        { uri: info.uri, title: info.title, artist: info.artist },
                        lyrics,
                        true
                    );
                }

                // 6. 이벤트 발생
                this.emit('lyrics-loaded', {
                    trackInfo: info,
                    lyrics,
                    provider,
                    contributors: lyricsResult.contributors || [],
                    hasTranslation: mode1 !== 'none' || mode2 !== 'none'
                });

                return { lyrics, provider, contributors: lyricsResult.contributors || [], error: null };
            } catch (e) {
                console.error('[LyricsService] getFullLyrics 실패:', e);
                return { lyrics: [], provider: null, error: e.message };
            }
        },

        /**
         * 커뮤니티 싱크 데이터 가져오기 (ivLyrics Sync)
         * @param {string} trackId - Spotify 트랙 ID
         * @param {string} provider - 가사 제공자 (예: spotify-abc, lrclib)
         * @returns {Promise<Object|null>}
         */
        async getIvLyricsSyncData(trackId, provider) {
            if (!trackId || !provider) return null;

            try {
                // provider가 spotify인 경우 내부 provider(abc 등)가 붙어있지 않다면 붙여준다
                // 하지만 호출하는 쪽에서 이미 처리가 되어있어야 함.
                // 여기서는 있는 그대로 호출.

                const response = await fetch(`https://lyrics.api.ivl.is/lyrics/sync-data?trackId=${trackId}&provider=${provider}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.provider === provider) {
                        return data;
                    }
                }
            } catch (e) {
                console.warn(`[LyricsService] Failed to fetch sync data for ${trackId} (${provider}):`, e);
            }
            return null;
        },

        /**
         * 가사 결과에 ivLyrics Sync 데이터 적용
         * @param {Object} result - 가사 결과 객체 (uri, provider, synced, unsynced 등 포함)
         * @returns {Promise<Object>} - Sync 데이터가 적용된 결과
         */
        async applyIvLyricsSyncData(result) {
            if (!result || !result.uri || !result.provider || !window.SyncDataService) {
                return result;
            }

            const trackId = result.uri.split(':')[2];
            const syncData = await this.getIvLyricsSyncData(trackId, result.provider);

            if (syncData && syncData.provider === result.provider) {
                const baseLyrics = result.synced || result.unsynced;
                const karaoke = window.SyncDataService.applySyncDataToLyrics(baseLyrics, syncData);

                if (karaoke) {
                    result.karaoke = karaoke;
                    result.syncDataApplied = true;
                    result.syncDataProvider = result.provider;

                    // sync-data가 있으면 synced도 오버라이드
                    const syncedFromSyncData = window.SyncDataService.convertKaraokeToSynced(karaoke);
                    if (syncedFromSyncData) {
                        result.synced = syncedFromSyncData;
                    }

                    // 기여자 정보 추가
                    if (syncData.contributors || syncData.syncData?.contributors) {
                        result.contributors = syncData.contributors || syncData.syncData.contributors;
                    }
                }
            }

            return result;
        },

        /**
         * TMI(Trivia) 가져오기
         * @param {Object} info - 트랙 정보 { trackId, title, artist, lang, ignoreCache }
         * @returns {Promise<Object|null>}
         */
        async getTMI(info) {
            const { trackId, title, artist, lang, ignoreCache } = info;
            if (!trackId) return null;

            const userLang = lang || Spicetify.Locale?.getLocale()?.split('-')[0] || 'en';

            try {
                // 1. 로컬 캐시 확인 (ignoreCache가 true면 스킵)
                if (!ignoreCache) {
                    const cached = await LyricsCache.getTMI(trackId, userLang);
                    if (cached) {
                        serviceDebug(`[LyricsService] getTMI: Using cached data for ${trackId}`);
                        return cached;
                    }
                }

                // 2. Addon_AI 요청
                if (window.AIAddonManager) {
                    serviceDebug(`[LyricsService] getTMI: Requesting from AIAddonManager${ignoreCache ? ' (ignoring cache)' : ''}`);
                    const result = await window.AIAddonManager.generateTMI({
                        trackId,
                        title,
                        artist,
                        lang: userLang
                    });

                    if (result) {
                        // 캐시 저장
                        await LyricsCache.setTMI(trackId, userLang, result);
                        return result;
                    }
                }
            } catch (e) {
                console.warn('[LyricsService] getTMI failed:', e);
            }
            return null;
        }
    };

    // 전역에 등록
    window.LyricsService = LyricsService;

    // ============================================
    // Translator Class - 번역 및 발음 변환
    // ============================================

    // 외부 라이브러리 경로
    const kuroshiroPath = "https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js";
    const kuromojiPath = "https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js";
    const aromanize = "https://cdn.jsdelivr.net/npm/aromanize@0.1.5/aromanize.min.js";
    const openCCPath = "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.min.js";
    const pinyinProPath = "https://cdn.jsdelivr.net/npm/pinyin-pro@3.19.7/dist/index.min.js";
    const tinyPinyinPath = "https://cdn.jsdelivr.net/npm/tiny-pinyin/dist/tiny-pinyin.min.js";
    const dictPath = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict";

    const resolveSpotifyImageUrl = (imageUrl) => {
        if (!imageUrl || imageUrl.indexOf("localfile") !== -1) {
            return null;
        }
        if (imageUrl.startsWith("spotify:image:")) {
            return `https://i.scdn.co/image/${imageUrl.substring(imageUrl.lastIndexOf(":") + 1)}`;
        }
        if (imageUrl.startsWith("http")) {
            return imageUrl;
        }
        return null;
    };

    // 전역 요청 상태 관리 (중복 요청 방지)
    const _translatorInflightRequests = new Map();
    const _translatorPendingRetries = new Map();

    // 진행 중인 요청 키 생성
    function getTranslatorRequestKey(trackId, wantSmartPhonetic, lang) {
        return `${trackId}:${wantSmartPhonetic ? 'phonetic' : 'translation'}:${lang}`;
    }

    // I18n이 로드되기 전에 기본 에러 메시지 반환
    function getTranslatorErrorMessage(key, fallback) {
        if (window.I18n && typeof window.I18n.t === 'function') {
            return window.I18n.t(key) || fallback;
        }
        return fallback;
    }

    // StorageManager가 없을 경우 대체
    function getStorageItem(key) {
        if (window.StorageManager && typeof window.StorageManager.getItem === 'function') {
            return window.StorageManager.getItem(key);
        }
        return Spicetify.LocalStorage.get(key);
    }

    // Utils가 없을 경우 대체
    function getUserHash() {
        return LyricsService.getUserHash();
    }

    // 현재 언어 가져오기
    function getCurrentLanguage() {
        if (window.I18n && typeof window.I18n.getCurrentLanguage === 'function') {
            return window.I18n.getCurrentLanguage();
        }
        return Spicetify.Locale?.getLocale()?.split('-')[0] || 'en';
    }

    // get the target language for translation (if auto, use the interface language)
    function getTranslationTargetLanguage() {
        // window.CONFIG가 초기화되지 않았을 수 있으므로 localStorage도 확인
        const targetLang = window.CONFIG?.visual?.["translate:target-language"] ||
            localStorage.getItem("ivLyrics:visual:translate:target-language");
        if (targetLang && targetLang !== "auto") {
            return targetLang;
        }
        return getCurrentLanguage();
    }

    class Translator {
        // 메타데이터 번역 캐시 (메모리)
        static _metadataCache = new Map();
        static _metadataInflightRequests = new Map();

        // 특정 trackId에 대한 진행 중인 요청 정리 (곡 변경 시 호출)
        static clearInflightRequests(trackId) {
            if (!trackId) return;

            for (const key of _translatorInflightRequests.keys()) {
                if (key.startsWith(`${trackId}:`)) {
                    _translatorInflightRequests.delete(key);
                }
            }

            for (const key of _translatorPendingRetries.keys()) {
                if (key.startsWith(`${trackId}:`)) {
                    _translatorPendingRetries.delete(key);
                }
            }
        }

        // 모든 진행 중인 요청 정리
        static clearAllInflightRequests() {
            _translatorInflightRequests.clear();
            _translatorPendingRetries.clear();
        }

        // 메모리 캐시 초기화 (특정 trackId)
        static clearMemoryCache(trackId) {
            if (!trackId) return;
            for (const key of this._metadataCache.keys()) {
                if (key.startsWith(`${trackId}:`)) {
                    this._metadataCache.delete(key);
                }
            }
        }

        // 모든 메모리 캐시 초기화
        static clearAllMemoryCache() {
            this._metadataCache.clear();
        }

        /**
         * 메타데이터 번역 (제목/아티스트)
         */
        static async translateMetadata({ trackId, title, artist, ignoreCache = false }) {
            if (!title || !artist) {
                return null;
            }

            let finalTrackId = trackId;
            if (!finalTrackId) {
                finalTrackId = Spicetify.Player.data?.item?.uri?.split(':')[2];
            }
            if (!finalTrackId) {
                return null;
            }

            const userLang = getTranslationTargetLanguage();
            const cacheKey = `${finalTrackId}:${userLang}`;

            // 메모리 캐시 확인
            if (!ignoreCache && this._metadataCache.has(cacheKey)) {
                return this._metadataCache.get(cacheKey);
            }

            // 로컬 캐시 확인
            if (!ignoreCache) {
                try {
                    const localCached = await LyricsCache.getMetadata(finalTrackId, userLang);
                    if (localCached) {
                        this._metadataCache.set(cacheKey, localCached);
                        return localCached;
                    }
                } catch (e) {
                    console.warn('[Translator] Local metadata cache check failed:', e);
                }
            }

            // AIAddonManager를 통한 번역 시도
            if (window.AIAddonManager) {
                serviceDebug(`[Translator] Using AIAddonManager for metadata`);

                if (this._metadataInflightRequests.has(cacheKey)) {
                    return this._metadataInflightRequests.get(cacheKey);
                }

                const addonPromise = (async () => {
                    try {
                        const result = await window.AIAddonManager.translateMetadata({
                            trackId: finalTrackId,
                            title,
                            artist,
                            lang: userLang
                        });

                        if (result) {
                            this._metadataCache.set(cacheKey, result);
                            LyricsCache.setMetadata(finalTrackId, userLang, result).catch(() => { });
                            return result;
                        }
                    } catch (e) {
                        console.warn('[Translator] AIAddonManager metadata translation failed:', e);
                    }
                    return null;
                })().finally(() => {
                    this._metadataInflightRequests.delete(cacheKey);
                });

                this._metadataInflightRequests.set(cacheKey, addonPromise);
                return addonPromise;
            }

            // AI 제공자가 설정되지 않았으면 null 반환
            serviceDebug('[Translator] No AI provider configured for metadata translation');
            return null;
        }

        static getMetadataFromCache(trackId) {
            const userLang = getTranslationTargetLanguage();
            const cacheKey = `${trackId}:${userLang}`;
            return this._metadataCache.get(cacheKey) || null;
        }

        static clearMetadataCache() {
            this._metadataCache.clear();
            this._metadataInflightRequests.clear();
        }

        constructor(lang, isUsingNetease = false) {
            this.finished = {
                ja: false, ko: false, zh: false, ru: false, vi: false,
                de: false, en: false, es: false, fr: false, it: false,
                pt: false, nl: false, pl: false, tr: false, ar: false,
                hi: false, th: false, id: false,
            };
            this.isUsingNetease = isUsingNetease;
            this.initializationPromise = null;
            this.kuroshiro = null;
            this.Aromanize = null;
            this.OpenCC = null;

            this.applyKuromojiFix();
            this.initializationPromise = this.initializeAsync(lang);
        }

        async initializeAsync(lang) {
            try {
                await this.injectExternals(lang);
                await this.createTranslator(lang);
            } catch (error) {
                throw error;
            }
        }

        static async callGemini({
            trackId,
            artist,
            title,
            text,
            wantSmartPhonetic = false,
            provider = null,
            ignoreCache = false,
            onLine = null,
        }) {
            if (!text?.trim()) throw new Error("No text provided for translation");

            let finalTrackId = trackId;
            if (!finalTrackId) {
                finalTrackId = Spicetify.Player.data?.item?.uri?.split(':')[2];
            }
            if (!finalTrackId) {
                throw new Error("No track ID available");
            }

            const userLang = getTranslationTargetLanguage();

            // 로컬 캐시 확인
            if (!ignoreCache) {
                try {
                    const localCached = await LyricsCache.getTranslation(finalTrackId, userLang, wantSmartPhonetic, provider);
                    if (localCached) {
                        if (window.ApiTracker) {
                            window.ApiTracker.logCacheHit(
                                wantSmartPhonetic ? 'phonetic' : 'translation',
                                `${finalTrackId}:${userLang}`,
                                { lineCount: localCached.phonetic?.length || localCached.translation?.length || 0 }
                            );
                        }
                        return localCached;
                    }
                } catch (e) {
                    console.warn('[Translator] Local cache check failed:', e);
                }
            }

            // AIAddonManager를 통한 번역 시도
            if (window.AIAddonManager) {
                serviceDebug(`[Translator] Using AIAddonManager for lyrics`);

                const requestKey = getTranslatorRequestKey(finalTrackId, wantSmartPhonetic, userLang);
                if (!ignoreCache && _translatorInflightRequests.has(requestKey)) {
                    return _translatorInflightRequests.get(requestKey);
                }

                const addonPromise = (async () => {
                    try {
                        const result = await window.AIAddonManager.translateLyrics({
                            trackId: finalTrackId,
                            artist,
                            title,
                            text,
                            lang: userLang,
                            wantSmartPhonetic,
                            provider,
                            onLine
                        });

                        if (result) {
                            LyricsCache.setTranslation(finalTrackId, userLang, wantSmartPhonetic, result, provider).catch(() => { });
                            return result;
                        }
                    } catch (e) {
                        console.warn('[Translator] AIAddonManager lyrics translation failed:', e);
                        throw e;
                    }
                    return null;
                })().finally(() => {
                    _translatorInflightRequests.delete(requestKey);
                });

                _translatorInflightRequests.set(requestKey, addonPromise);
                return addonPromise;
            }

            // AI 제공자가 설정되지 않았으면 에러
            serviceDebug('[Translator] No AI provider configured for lyrics translation');
            throw new Error(getTranslatorErrorMessage("translator.noProviderConfigured", "AI 제공자가 설정되지 않았습니다. 설정에서 AI 제공자를 선택해주세요."));
        }

        includeExternal(url) {
            return new Promise((resolve, reject) => {
                const existingScript = document.querySelector(`script[src="${url}"]`);
                if (existingScript) {
                    if (existingScript.dataset) existingScript.dataset.loaded = existingScript.dataset.loaded || "true";
                    return resolve();
                }

                const script = document.createElement("script");
                script.setAttribute("type", "text/javascript");
                script.setAttribute("src", url);

                script.addEventListener("load", () => {
                    script.dataset.loaded = "true";
                    resolve();
                });

                script.addEventListener("error", () => {
                    reject(new Error(`Failed to load script: ${url}`));
                });

                document.head.appendChild(script);
            });
        }

        async injectExternals(lang) {
            const langCode = lang?.slice(0, 2);
            try {
                switch (langCode) {
                    case "ja":
                        await Promise.all([
                            this.includeExternal(kuromojiPath),
                            this.includeExternal(kuroshiroPath),
                        ]);
                        break;
                    case "ko":
                        await this.includeExternal(aromanize);
                        break;
                    case "zh":
                        await this.includeExternal(openCCPath);
                        this.includeExternal(pinyinProPath).catch(() => { });
                        this.includeExternal(tinyPinyinPath).catch(() => { });
                        break;
                    case "ru":
                    case "vi":
                    case "de":
                    case "en":
                    case "es":
                    case "fr":
                    case "it":
                    case "pt":
                    case "nl":
                    case "pl":
                    case "tr":
                    case "ar":
                    case "hi":
                    case "th":
                    case "id":
                        this.finished[langCode] = true;
                        break;
                }
            } catch (error) {
                throw error;
            }
        }

        async awaitFinished(language) {
            const langCode = language?.slice(0, 2);
            if (this.initializationPromise) {
                await this.initializationPromise;
            }
            if (langCode && !this.finished[langCode]) {
                await this.injectExternals(language);
                await this.createTranslator(language);
            }
        }

        applyKuromojiFix() {
            if (typeof XMLHttpRequest.prototype.realOpen !== "undefined") return;
            XMLHttpRequest.prototype.realOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url, bool) {
                if (url.indexOf(dictPath.replace("https://", "https:/")) === 0) {
                    this.realOpen(method, url.replace("https:/", "https://"), bool);
                } else {
                    this.realOpen(method, url, bool);
                }
            };
        }

        async createTranslator(lang) {
            const langCode = lang.slice(0, 2);

            switch (langCode) {
                case "ja":
                    if (this.kuroshiro) return;
                    await this.waitForGlobals(["Kuroshiro", "KuromojiAnalyzer"], 10000);
                    this.kuroshiro = new Kuroshiro.default();
                    await this.kuroshiro.init(new KuromojiAnalyzer({ dictPath }));
                    this.finished.ja = true;
                    break;

                case "ko":
                    if (this.Aromanize) return;
                    await this.waitForGlobals(["Aromanize"], 5000);
                    this.Aromanize = Aromanize;
                    this.finished.ko = true;
                    break;

                case "zh":
                    if (this.OpenCC) return;
                    await this.waitForGlobals(["OpenCC"], 5000);
                    this.OpenCC = OpenCC;
                    this.finished.zh = true;
                    break;

                case "ru":
                case "vi":
                case "de":
                case "en":
                case "es":
                case "fr":
                case "it":
                case "pt":
                case "nl":
                case "pl":
                case "tr":
                case "ar":
                case "hi":
                case "th":
                case "id":
                    this.finished[langCode] = true;
                    break;
            }
        }

        async waitForGlobals(globalNames, timeoutMs = 5000) {
            const startTime = Date.now();

            return new Promise((resolve, reject) => {
                const checkGlobals = () => {
                    const allAvailable = globalNames.every((name) => typeof window[name] !== "undefined");

                    if (allAvailable) {
                        resolve();
                        return;
                    }

                    if (Date.now() - startTime > timeoutMs) {
                        reject(new Error(`Timeout waiting for globals: ${globalNames.join(", ")}`));
                        return;
                    }

                    setTimeout(checkGlobals, 50);
                };

                checkGlobals();
            });
        }

        static _romajiMap = { 'ō': 'ou', 'ū': 'uu', 'ā': 'aa', 'ī': 'ii', 'ē': 'ee' };
        static _romajiPattern = /[ōūāīē]/g;

        static normalizeRomajiString(s) {
            if (typeof s !== "string") return "";
            return s
                .replace(this._romajiPattern, match => this._romajiMap[match])
                .replace(/\s{2,}/g, " ")
                .trim();
        }

        async romajifyText(text, target = "romaji", mode = "spaced") {
            await this.awaitFinished("ja");
            const out = await this.kuroshiro.convert(text, {
                to: target,
                mode: mode,
                romajiSystem: "hepburn",
            });
            return window.Translator.normalizeRomajiString(out);
        }

        async convertToRomaja(text, target) {
            await this.awaitFinished("ko");
            if (target === "hangul") return text;
            if (!this.Aromanize || typeof this.Aromanize.hangulToLatin !== "function") {
                throw new Error("Korean converter not initialized");
            }
            return this.Aromanize.hangulToLatin(text, "rr-translit");
        }

        async convertChinese(text, from, target) {
            await this.awaitFinished("zh");
            const converter = this.OpenCC.Converter({
                from: from,
                to: target,
            });
            return converter(text);
        }

        async loadPinyinPro() {
            if (typeof pinyinPro !== "undefined") return true;
            const urls = [
                pinyinProPath,
                "https://cdn.jsdelivr.net/npm/pinyin-pro@3.19.7/dist/index.js",
                "https://unpkg.com/pinyin-pro@3.19.7/dist/index.min.js",
            ];
            for (const url of urls) {
                try {
                    await this.includeExternal(url);
                    await this.waitForGlobals(["pinyinPro"], 8000);
                    return true;
                } catch { }
            }
            return false;
        }

        async loadTinyPinyin() {
            if (typeof TinyPinyin !== "undefined") return true;
            const urls = [
                tinyPinyinPath,
                "https://unpkg.com/tiny-pinyin/dist/tiny-pinyin.min.js",
            ];
            for (const url of urls) {
                try {
                    await this.includeExternal(url);
                    await this.waitForGlobals(["TinyPinyin"], 8000);
                    return true;
                } catch { }
            }
            return false;
        }

        async convertToPinyin(text, options = {}) {
            try {
                if (await this.loadTinyPinyin()) {
                    return TinyPinyin.convertToPinyin(text || "");
                }
                if (await this.loadPinyinPro()) {
                    const toneType = options.toneType || "mark";
                    const type = options.type || "string";
                    const nonZh = options.nonZh || "consecutive";
                    return pinyinPro.pinyin(text || "", { toneType, type, nonZh });
                }
                return text || "";
            } catch {
                return text || "";
            }
        }
    }

    // 전역에 Translator 등록
    window.Translator = Translator;

    // ============================================
    // OverlaySender - 오버레이 앱에 데이터 전송
    // Extension으로 이동하여 어떤 페이지에서든 작동
    // ============================================

    const OverlaySender = {
        DEFAULT_PORT: 15000,
        progressInterval: null,
        lastSentUri: null,
        lastSentLyrics: null,
        lastSentOffset: null,
        _lastTrackInfo: null,
        _lastLyrics: null,
        lastConfigDelay: undefined,
        _offsetCache: {},

        // 연결 상태
        _isConnected: false,
        _connectionCheckInterval: null,
        _lastConnectionAttempt: 0,
        _isSettingsOpen: false,
        _settingsTimer: null,
        _worker: null,
        _isSendingProgress: false,
        _reqId: 0,
        _lastReqId: 0,

        // 포트 설정 (localStorage에 저장)
        get port() {
            const savedPort = Spicetify.LocalStorage.get('ivLyrics:overlay-port');
            return savedPort ? parseInt(savedPort, 10) : this.DEFAULT_PORT;
        },
        set port(value) {
            const portNum = parseInt(value, 10);
            if (portNum >= 1024 && portNum <= 65535) {
                Spicetify.LocalStorage.set('ivLyrics:overlay-port', portNum.toString());
                this.isConnected = false;
                this.checkConnection();
            }
        },

        // 설정 (localStorage에 저장)
        get enabled() {
            return Spicetify.LocalStorage.get('ivLyrics:overlay-enabled') !== 'false';
        },
        set enabled(value) {
            Spicetify.LocalStorage.set('ivLyrics:overlay-enabled', value ? 'true' : 'false');
            if (value) {
                this.startProgressSync();
                this.checkConnection();
            } else {
                clearSettingsPolling(this);
                this.stopProgressSync();
            }
        },

        setSettingsOpen(isOpen) {
            this._isSettingsOpen = isOpen;
            clearSettingsPolling(this);

            if (isOpen) {
                helperDebug('[OverlaySender] 설정창 열림 - 연결 확인 폴링 시작');
                this.checkConnection();
                this._settingsTimer = setInterval(() => {
                    if (!this.isConnected) {
                        this.checkConnection();
                    }
                }, 2000);
            } else {
                helperDebug('[OverlaySender] 설정창 닫힘 - 연결 확인 폴링 종료');
            }
        },

        get isConnected() {
            return this._isConnected;
        },
        set isConnected(value) {
            const wasConnected = this._isConnected;
            this._isConnected = value;

            window.dispatchEvent(new CustomEvent('ivLyrics:overlay-connection', {
                detail: { connected: value }
            }));

            if (value && !wasConnected) {
                helperDebug('[OverlaySender] 오버레이 연결됨 ✓');
                setTimeout(() => this.resendWithNewOffset(), 100);
            }
            else if (!value && wasConnected) {
                helperDebug('[OverlaySender] 오버레이 연결 끊김');
            }
        },

        async checkConnection() {
            if (!this.enabled) return false;

            try {
                const response = await fetch(`http://localhost:${this.port}/progress`, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ position: 0, isPlaying: false }),
                    signal: AbortSignal.timeout(1000)
                });
                this.isConnected = response.ok;
                return this.isConnected;
            } catch (e) {
                this.isConnected = false;
                return false;
            }
        },

        openOverlayApp() {
            try {
                window.open('ivLyrics://overlay', '_blank');
                setTimeout(() => this.checkConnection(), 2000);
            } catch (e) {
                console.error('[OverlaySender] 앱 열기 실패:', e);
            }
        },

        getDownloadUrl() {
            return 'https://ivlis.kr/ivLyrics/extensions/#overlay';
        },

        async sendToEndpoint(endpoint, data) {
            if (!this.enabled) return;

            try {
                const response = await fetch(`http://localhost:${this.port}${endpoint}`, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    signal: AbortSignal.timeout(2000)
                });

                if (!this._isConnected && response.ok) {
                    this.isConnected = true;
                }
            } catch (e) {
                if (this._isConnected) {
                    this.isConnected = false;
                }
            }
        },

        // 싱크 오프셋 가져오기
        async getSyncOffset(uri) {
            let offset = 0;

            // 1. 전역 딜레이 설정 (CONFIG가 로드되면)
            if (typeof window.CONFIG !== 'undefined' && window.CONFIG.visual && typeof window.CONFIG.visual.delay === 'number') {
                offset += window.CONFIG.visual.delay;
            }

            // 2. TrackSyncDB에서 트랙별 오프셋
            if (this._offsetCache && this._offsetCache[uri] !== undefined) {
                offset += this._offsetCache[uri];
            } else {
                try {
                    if (typeof window.TrackSyncDB !== 'undefined' && window.TrackSyncDB.getOffset) {
                        const dbOffset = await window.TrackSyncDB.getOffset(uri);
                        if (dbOffset) {
                            offset += dbOffset;
                            this._offsetCache[uri] = dbOffset;
                        }
                    }
                } catch (e) { }
            }

            // 3. localStorage 개별 트랙 딜레이
            try {
                const delayKey = `lyrics-delay:${uri}`;
                const delay = Spicetify.LocalStorage.get(delayKey);
                if (delay) offset += Number(delay);
            } catch (e) { }

            return -offset;
        },

        async sendLyrics(trackInfo, lyrics, forceResend = false) {
            if (!trackInfo || !lyrics || !Array.isArray(lyrics)) return;
            if (!this.enabled) return;

            const currentReqId = ++this._reqId;

            this._lastTrackInfo = trackInfo;
            this._lastLyrics = lyrics;

            const offset = await this.getSyncOffset(trackInfo.uri);

            if (currentReqId < this._lastReqId) {
                helperDebug(`[OverlaySender] 오래된 요청 무시됨 (#${currentReqId} < #${this._lastReqId})`);
                return;
            }
            this._lastReqId = currentReqId;

            const lyricsHash = JSON.stringify(lyrics);

            if (!forceResend &&
                this.lastSentUri === trackInfo.uri &&
                this.lastSentLyrics === lyricsHash &&
                this.lastSentOffset === offset) {
                return;
            }

            this.lastSentUri = trackInfo.uri;
            this.lastSentLyrics = lyricsHash;
            this.lastSentOffset = offset;

            // 앨범 이미지 URL 처리 개선
            let albumArt = null;
            try {
                const imageUrl = Spicetify.Player.data?.item?.metadata?.image_xlarge_url
                    || Spicetify.Player.data?.item?.metadata?.image_url
                    || Spicetify.Player.data?.item?.metadata?.image_large_url;
                albumArt = resolveSpotifyImageUrl(imageUrl);
            } catch (e) { }

            const mappedLines = lyrics.map(l => {
                const originalText = l.originalText || l.text || '';
                const pronText = (l.text && l.text !== l.originalText && l.text !== originalText) ? l.text : null;
                let transText = l.text2 || l.translation || l.translationText || null;
                if (transText && typeof transText === 'string' && transText.trim() === '') {
                    transText = null;
                }
                if (transText && transText === originalText) {
                    transText = null;
                }

                // startTime과 endTime을 숫자로 안전하게 변환
                const startTimeNum = typeof l.startTime === 'number' ? l.startTime : (parseInt(l.startTime, 10) || 0);
                const endTimeNum = l.endTime != null ? (typeof l.endTime === 'number' ? l.endTime : (parseInt(l.endTime, 10) || null)) : null;

                return {
                    startTime: startTimeNum + offset,
                    endTime: endTimeNum !== null ? endTimeNum + offset : null,
                    text: originalText,
                    pronText: pronText,
                    transText: transText
                };
            });

            // 현재 트랙 정보 가져오기 (Spicetify.Player.data에서 최신 정보 사용)
            const originalTitle = trackInfo.title || Spicetify.Player.data?.item?.metadata?.title || '';
            const originalArtist = trackInfo.artist || Spicetify.Player.data?.item?.metadata?.artist_name || '';
            const currentAlbum = Spicetify.Player.data?.item?.metadata?.album_title || '';

            // 번역된 메타데이터가 있으면 대체
            const translatedMetadata = trackInfo.translatedMetadata || null;
            const currentTitle = translatedMetadata?.translated?.title || originalTitle;
            const currentArtist = translatedMetadata?.translated?.artist || originalArtist;

            helperDebug('[OverlaySender] 가사 전송:', {
                lines: mappedLines.length,
                offset,
                title: currentTitle,
                artist: currentArtist,
                translated: !!translatedMetadata
            });

            await this.sendToEndpoint('/lyrics', {
                track: {
                    title: currentTitle,
                    artist: currentArtist,
                    album: currentAlbum,
                    albumArt: albumArt,
                    duration: Spicetify.Player.getDuration() || 0
                },
                lyrics: mappedLines,
                isSynced: lyrics.some(l => l.startTime !== undefined && l.startTime !== null)
            });
        },

        async resendWithNewOffset() {
            // 오프셋 캐시 초기화
            this._offsetCache = {};
            if (this._lastTrackInfo && this._lastLyrics) {
                helperDebug('[OverlaySender] 가사 재전송 (싱크 반영)');
                await this.sendLyrics(this._lastTrackInfo, this._lastLyrics, true);
            }
        },

        async sendTranslatedMetadata(translatedMetadata) {
            if (!this.enabled || !translatedMetadata) return;
            if (!this._lastTrackInfo || !this._lastLyrics) return;

            // 번역된 메타데이터를 포함하여 가사 재전송
            this._lastTrackInfo.translatedMetadata = translatedMetadata;
            helperDebug('[OverlaySender] 번역된 메타데이터로 재전송');
            await this.sendLyrics(this._lastTrackInfo, this._lastLyrics, true);
        },

        startProgressSync() {
            if (this._worker) return;
            if (!this.enabled) return;

            const blob = new Blob([`
              let interval = null;
              self.onmessage = function(e) {
                if (e.data === 'start') {
                  if (interval) clearInterval(interval);
                  interval = setInterval(() => {
                    self.postMessage('tick');
                  }, 250);
                } else if (e.data === 'stop') {
                  if (interval) clearInterval(interval);
                  interval = null;
                }
              };
            `], { type: 'application/javascript' });

            this._worker = new Worker(URL.createObjectURL(blob));

            this._worker.onmessage = async () => {
                if (!this.enabled) return;
                if (this._isSendingProgress) return;
                if (!this.isConnected && !this._isSettingsOpen) return;

                // 전역 딜레이 변경 체크
                if (typeof window.CONFIG !== 'undefined' && window.CONFIG.visual) {
                    if (this.lastConfigDelay === undefined) {
                        this.lastConfigDelay = window.CONFIG.visual.delay;
                    }
                    if (this.lastConfigDelay !== window.CONFIG.visual.delay) {
                        this.lastConfigDelay = window.CONFIG.visual.delay;
                        this.resendWithNewOffset();
                    }
                }

                this._isSendingProgress = true;
                try {
                    const position = Spicetify.Player.getProgress() || 0;
                    const duration = Spicetify.Player.getDuration() || 0;
                    const remaining = (duration - position) / 1000;

                    // 현재 트랙 정보 (트랙 변경 감지용)
                    let currentTrack = null;
                    const currentUri = Spicetify.Player.data?.item?.uri;
                    if (currentUri && this._lastProgressUri !== currentUri) {
                        this._lastProgressUri = currentUri;
                        try {
                            const imageUrl = Spicetify.Player.data?.item?.metadata?.image_xlarge_url
                                || Spicetify.Player.data?.item?.metadata?.image_url
                                || Spicetify.Player.data?.item?.metadata?.image_large_url;
                            let albumArt = null;
                            albumArt = resolveSpotifyImageUrl(imageUrl);
                            currentTrack = {
                                title: Spicetify.Player.data?.item?.metadata?.title || '',
                                artist: Spicetify.Player.data?.item?.metadata?.artist_name || '',
                                album: Spicetify.Player.data?.item?.metadata?.album_title || '',
                                albumArt: albumArt
                            };
                        } catch (e) { }
                    }

                    let nextTrack = null;
                    try {
                        const queue = Spicetify.Queue;
                        if (queue?.nextTracks?.length > 0) {
                            const next = queue.nextTracks[0];
                            if (next?.contextTrack?.metadata) {
                                const imageUrl = next.contextTrack.metadata.image_url || next.contextTrack.metadata.image_xlarge_url;
                                const albumArt = resolveSpotifyImageUrl(imageUrl);
                                nextTrack = {
                                    title: next.contextTrack.metadata.title || '',
                                    artist: next.contextTrack.metadata.artist_name || '',
                                    albumArt: albumArt
                                };
                            }
                        }
                    } catch (e) { }

                    await this.sendToEndpoint('/progress', {
                        position: position,
                        isPlaying: Spicetify.Player.isPlaying() || false,
                        duration: duration,
                        remaining: remaining,
                        currentTrack: currentTrack,
                        nextTrack: nextTrack
                    });
                } finally {
                    this._isSendingProgress = false;
                }
            };

            this._worker.postMessage('start');
        },

        stopProgressSync() {
            if (this._worker) {
                this._worker.terminate();
                this._worker = null;
            }
        },

        setupOffsetListener() {
            // 중복 호출 방지
            if (this._offsetListenerSetup) return;
            this._offsetListenerSetup = true;

            // localStorage 변경 감지
            window.addEventListener('storage', (e) => {
                if (e.key && e.key.startsWith('lyrics-delay:')) {
                    this.resendWithNewOffset();
                }
            });

            // 커스텀 이벤트 리스너
            window.addEventListener('ivLyrics:delay-changed', () => {
                this.resendWithNewOffset();
            });

            window.addEventListener('ivLyrics:offset-changed', () => {
                this.resendWithNewOffset();
            });

            // ivLyrics 페이지에서 가사가 준비되면 오버레이로 전송
            window.addEventListener('ivLyrics:lyrics-ready', (e) => {
                if (!this.enabled) return;
                const { trackInfo, lyrics } = e.detail || {};
                if (trackInfo) {
                    helperDebug('[OverlaySender] 가사 준비 이벤트 수신:', {
                        uri: trackInfo.uri,
                        title: trackInfo.title,
                        lines: lyrics?.length || 0
                    });
                    this.sendLyrics(trackInfo, lyrics || []);
                }
            });

            // 페이지 가시성 변경 감지
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && this.enabled) {
                    helperDebug('[OverlaySender] 페이지 활성화 - 가사 재전송');
                    setTimeout(() => this.resendWithNewOffset(), 200);
                }
            });

            // 창 포커스 시
            window.addEventListener('focus', () => {
                if (this.enabled && this._lastTrackInfo) {
                    helperDebug('[OverlaySender] 창 포커스 - 가사 재전송');
                    setTimeout(() => this.resendWithNewOffset(), 300);
                }
            });

            // 트랙 변경 감지
            Spicetify.Player.addEventListener('songchange', async () => {
                // 캐시 초기화
                this.lastSentUri = null;
                this.lastSentLyrics = null;
                this.lastSentOffset = null;
                this._offsetCache = {};
                this._lastProgressUri = null;

                // 오버레이 활성화 상태가 아니면 스킵
                if (!this.enabled) return;

                // ivLyrics 페이지에 있으면 index.js가 처리하므로 스킵
                // (lyrics-ready 이벤트를 통해 가사가 전송됨)
                const pathname = Spicetify.Platform?.History?.location?.pathname || "";
                if (pathname.includes("/ivLyrics")) {
                    helperDebug('[OverlaySender] ivLyrics 페이지 - index.js가 처리');
                    return;
                }

                // 다른 페이지에서 곡 변경됨 - 직접 가사 가져와서 전송
                helperDebug('[OverlaySender] 다른 페이지에서 곡 변경 감지');

                // 트랙 정보가 완전히 로드될 때까지 대기
                const waitForTrackData = () => {
                    return new Promise((resolve) => {
                        const check = () => {
                            const data = Spicetify.Player.data;
                            if (data?.item?.uri && data?.item?.metadata?.title) {
                                resolve(data);
                            } else {
                                setTimeout(check, 100);
                            }
                        };
                        check();
                        // 3초 타임아웃
                        setTimeout(() => resolve(null), 3000);
                    });
                };

                try {
                    const playerData = await waitForTrackData();
                    if (!playerData?.item) {
                        helperDebug('[OverlaySender] 트랙 데이터 로드 실패');
                        return;
                    }

                    const uri = playerData.item.uri;
                    const title = playerData.item.metadata?.title || '';
                    const artist = playerData.item.metadata?.artist_name || '';
                    const duration = Spicetify.Player.getDuration() || 0;

                    helperDebug('[OverlaySender] 트랙 정보:', { title, artist });

                    // LyricsService.getFullLyrics 통합 API 사용
                    // (가사 로드 + endTime 계산 + 발음/번역 + 오버레이 전송까지 한 번에 처리)
                    await LyricsService.getFullLyrics(
                        { uri, title, artist, duration },
                        { sendToOverlay: true }
                    );
                } catch (e) {
                    console.error('[OverlaySender] 가사 가져오기 실패:', e);
                }
            });
        },

        init() {
            if (this._initialized) return;
            this._initialized = true;
            if (this.enabled) {
                this.startProgressSync();
                this.setupOffsetListener();
                setTimeout(() => this.checkConnection(), 1000);
            }
            helperDebug('[OverlaySender] Initialized in Extension');
        }
    };

    const lyricsHelperSender = Object.create(OverlaySender, {
        DEFAULT_PORT: {
            value: 15123  // Helper 서버 포트 (video_server와 lyrics_server 통합)
        },
        port: {
            get() {
                return this.DEFAULT_PORT;
            }
        },
        enabled: {
            get() {
                return Spicetify.LocalStorage.get('ivLyrics:visual:lyrics-helper-enabled') !== 'false';
            },
            set(value) {
                Spicetify.LocalStorage.set('ivLyrics:visual:lyrics-helper-enabled', value ? 'true' : 'false');
                if (value) {
                    this.startProgressSync();
                    this.checkConnection();
                } else {
                    clearSettingsPolling(this);
                    this.teardownOffsetListener();
                    this.stopProgressSync();
                }
            }
        },
        setSettingsOpen: {
            value: function (isOpen) {
                this._isSettingsOpen = isOpen;
                clearSettingsPolling(this);

                if (isOpen) {
                    helperDebug('[lyricsHelperSender] 설정창 열림 - 연결 확인 폴링 시작');
                    this.checkConnection();
                    this._settingsTimer = setInterval(() => {
                        if (!this.isConnected) {
                            this.checkConnection();
                        }
                    }, 2000);
                } else {
                    helperDebug('[lyricsHelperSender] 설정창 닫힘 - 연결 확인 폴링 종료');
                }
            }
        },
        isConnected: {
            get() {
                return this._isConnected;
            },
            set(value) {
                const wasConnected = this._isConnected;
                this._isConnected = value;

                window.dispatchEvent(new CustomEvent('ivLyrics:lyrics-helper-connection', {
                    detail: { connected: value }
                }));

                if (value && !wasConnected) {
                    helperDebug('[lyricsHelperSender] 헬퍼 연결됨 ✓');
                    setTimeout(() => this.resendWithNewOffset(), 100);
                }
                else if (!value && wasConnected) {
                    helperDebug('[lyricsHelperSender] 헬퍼 연결 끊김');
                }
            }
        },
        sendLyrics: {
            value: async function (trackInfo, lyrics, forceResend = false) {
                if (!trackInfo || !lyrics || !Array.isArray(lyrics)) return;
                if (!this.enabled) return;

                const currentReqId = ++this._reqId;

                this._lastTrackInfo = trackInfo;
                this._lastLyrics = lyrics;

                const offset = await this.getSyncOffset(trackInfo.uri);

                if (currentReqId < this._lastReqId) {
                    helperDebug(`[lyricsHelperSender] 오래된 요청 무시됨 (#${currentReqId} < #${this._lastReqId})`);
                    return;
                }
                this._lastReqId = currentReqId;

                const lyricsHash = JSON.stringify(lyrics);

                if (!forceResend &&
                    this.lastSentUri === trackInfo.uri &&
                    this.lastSentLyrics === lyricsHash &&
                    this.lastSentOffset === offset) {
                    return;
                }

                this.lastSentUri = trackInfo.uri;
                this.lastSentLyrics = lyricsHash;
                this.lastSentOffset = offset;

                // 앨범 이미지 URL 처리 개선
                let albumArt = null;
                try {
                    const imageUrl = Spicetify.Player.data?.item?.metadata?.image_xlarge_url
                        || Spicetify.Player.data?.item?.metadata?.image_url
                        || Spicetify.Player.data?.item?.metadata?.image_large_url;
                    albumArt = resolveSpotifyImageUrl(imageUrl);
                } catch (e) { }

                const mappedLines = lyrics.map(l => {
                    const originalText = l.originalText || l.text || '';
                    const pronText = (l.text && l.text !== l.originalText && l.text !== originalText) ? l.text : null;
                    let transText = l.text2 || l.translation || l.translationText || null;
                    if (transText && typeof transText === 'string' && transText.trim() === '') {
                        transText = null;
                    }
                    if (transText && transText === originalText) {
                        transText = null;
                    }

                    // startTime과 endTime을 숫자로 안전하게 변환
                    const startTimeNum = typeof l.startTime === 'number' ? l.startTime : (parseInt(l.startTime, 10) || 0);
                    const endTimeNum = l.endTime != null ? (typeof l.endTime === 'number' ? l.endTime : (parseInt(l.endTime, 10) || null)) : null;

                    return {
                        startTime: startTimeNum + offset,
                        endTime: endTimeNum !== null ? endTimeNum + offset : null,
                        text: originalText,
                        pronText: pronText,
                        transText: transText
                    };
                });

                // 현재 트랙 정보 가져오기 (Spicetify.Player.data에서 최신 정보 사용)
                const currentTitle = trackInfo.title || Spicetify.Player.data?.item?.metadata?.title || '';
                const currentArtist = trackInfo.artist || Spicetify.Player.data?.item?.metadata?.artist_name || '';
                const currentAlbum = Spicetify.Player.data?.item?.metadata?.album_title || '';

                helperDebug('[lyricsHelperSender] 가사 전송:', {
                    lines: mappedLines.length,
                    offset,
                    title: currentTitle,
                    artist: currentArtist
                });

                // 새로운 엔드포인트 사용: /lyrics/sender
                await this.sendToEndpoint('/lyrics/sender', {
                    track: {
                        title: currentTitle,
                        artist: currentArtist,
                        album: currentAlbum,
                        albumArt: albumArt,
                        duration: Spicetify.Player.getDuration() || 0
                    },
                    lyrics: mappedLines,
                    isSynced: lyrics.some(l => l.startTime !== undefined && l.startTime !== null)
                });
            }
        },
        resendWithNewOffset: {
            value: async function () {
                this._offsetCache = {};
                if (this._lastTrackInfo && this._lastLyrics) {
                    helperDebug('[lyricsHelperSender] 가사 재전송 (싱크 반영)');
                    await this.sendLyrics(this._lastTrackInfo, this._lastLyrics, true);
                }
            }
        },
        // progress 전송용 엔드포인트 오버라이드
        sendProgressToEndpoint: {
            value: async function (data) {
                if (!this.enabled) return;
                try {
                    const response = await fetch(`http://localhost:${this.port}/lyrics/progress`, {
                        method: 'POST',
                        mode: 'cors',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data),
                        signal: AbortSignal.timeout(2000)
                    });
                    if (!this._isConnected && response.ok) {
                        this.isConnected = true;
                    }
                } catch (e) {
                    if (this._isConnected) {
                        this.isConnected = false;
                    }
                }
            }
        },
        setupOffsetListener: {
            value: function () {
                // 중복 호출 방지
                if (this._offsetListenerSetup) return;
                this._offsetListenerSetup = true;

                this._storageListener = (e) => {
                    if (e.key && e.key.startsWith('lyrics-delay:')) {
                        this.resendWithNewOffset();
                    }
                };

                this._delayChangedListener = () => {
                    this.resendWithNewOffset();
                };

                this._offsetChangedListener = () => {
                    this.resendWithNewOffset();
                };

                this._lyricsReadyListener = (e) => {
                    if (!this.enabled) return;
                    const { trackInfo, lyrics } = e.detail || {};
                    if (trackInfo) {
                        helperDebug('[lyricsHelperSender] 가사 준비 이벤트 수신:', {
                            uri: trackInfo.uri,
                            title: trackInfo.title,
                            lines: lyrics?.length || 0
                        });
                        this.sendLyrics(trackInfo, lyrics || []);
                    }
                };

                this._visibilityChangeListener = () => {
                    if (document.visibilityState === 'visible' && this.enabled) {
                        helperDebug('[lyricsHelperSender] 페이지 활성화 - 가사 재전송');
                        setTimeout(() => this.resendWithNewOffset(), 200);
                    }
                };

                this._focusListener = () => {
                    if (this.enabled && this._lastTrackInfo) {
                        helperDebug('[lyricsHelperSender] 창 포커스 - 가사 재전송');
                        setTimeout(() => this.resendWithNewOffset(), 300);
                    }
                };

                this._songChangeListener = async () => {
                    // 캐시 초기화
                    this.lastSentUri = null;
                    this.lastSentLyrics = null;
                    this.lastSentOffset = null;
                    this._offsetCache = {};
                    this._lastProgressUri = null;

                    // 오버레이 활성화 상태가 아니면 스킵
                    if (!this.enabled) return;

                    // ivLyrics 페이지에 있으면 index.js가 처리하므로 스킵
                    // (lyrics-ready 이벤트를 통해 가사가 전송됨)
                    const pathname = Spicetify.Platform?.History?.location?.pathname || "";
                    if (pathname.includes("/ivLyrics")) {
                        helperDebug('[lyricsHelperSender] ivLyrics 페이지 - index.js가 처리');
                        return;
                    }

                    // 다른 페이지에서 곡 변경됨 - 직접 가사 가져와서 전송
                    helperDebug('[lyricsHelperSender] 다른 페이지에서 곡 변경 감지');

                    // 트랙 정보가 완전히 로드될 때까지 대기
                    const waitForTrackData = () => {
                        return new Promise((resolve) => {
                            const check = () => {
                                const data = Spicetify.Player.data;
                                if (data?.item?.uri && data?.item?.metadata?.title) {
                                    resolve(data);
                                } else {
                                    setTimeout(check, 100);
                                }
                            };
                            check();
                            // 3초 타임아웃
                            setTimeout(() => resolve(null), 3000);
                        });
                    };

                    try {
                        const playerData = await waitForTrackData();
                        if (!playerData?.item) {
                            helperDebug('[lyricsHelperSender] 트랙 데이터 로드 실패');
                            return;
                        }

                        const uri = playerData.item.uri;
                        const title = playerData.item.metadata?.title || '';
                        const artist = playerData.item.metadata?.artist_name || '';
                        const duration = Spicetify.Player.getDuration() || 0;

                        helperDebug('[lyricsHelperSender] 트랙 정보:', { title, artist });

                        // LyricsService.getFullLyrics 통합 API 사용
                        // (가사 로드 + endTime 계산 + 발음/번역 + 오버레이 전송까지 한 번에 처리)
                        await LyricsService.getFullLyrics(
                            { uri, title, artist, duration },
                            { sendToOverlay: true }
                        );
                    } catch (e) {
                        console.error('[lyricsHelperSender] 가사 가져오기 실패:', e);
                    }
                };

                window.addEventListener('storage', this._storageListener);
                window.addEventListener('ivLyrics:delay-changed', this._delayChangedListener);
                window.addEventListener('ivLyrics:offset-changed', this._offsetChangedListener);
                window.addEventListener('ivLyrics:lyrics-ready', this._lyricsReadyListener);
                document.addEventListener('visibilitychange', this._visibilityChangeListener);
                window.addEventListener('focus', this._focusListener);
                Spicetify.Player.addEventListener('songchange', this._songChangeListener);
            }
        },
        teardownOffsetListener: {
            value: function () {
                if (!this._offsetListenerSetup) return;
                this._offsetListenerSetup = false;

                if (this._storageListener) {
                    window.removeEventListener('storage', this._storageListener);
                    this._storageListener = null;
                }
                if (this._delayChangedListener) {
                    window.removeEventListener('ivLyrics:delay-changed', this._delayChangedListener);
                    this._delayChangedListener = null;
                }
                if (this._offsetChangedListener) {
                    window.removeEventListener('ivLyrics:offset-changed', this._offsetChangedListener);
                    this._offsetChangedListener = null;
                }
                if (this._lyricsReadyListener) {
                    window.removeEventListener('ivLyrics:lyrics-ready', this._lyricsReadyListener);
                    this._lyricsReadyListener = null;
                }
                if (this._visibilityChangeListener) {
                    document.removeEventListener('visibilitychange', this._visibilityChangeListener);
                    this._visibilityChangeListener = null;
                }
                if (this._focusListener) {
                    window.removeEventListener('focus', this._focusListener);
                    this._focusListener = null;
                }
                if (this._songChangeListener && typeof Spicetify.Player?.removeEventListener === 'function') {
                    try {
                        Spicetify.Player.removeEventListener('songchange', this._songChangeListener);
                    } catch (e) { }
                    this._songChangeListener = null;
                }
            }
        },
        startProgressSync: {
            value: function () {
                if (this._worker) return;
                if (!this.enabled) return;

                const blob = new Blob([`
                  let interval = null;
                  self.onmessage = function(e) {
                    if (e.data === 'start') {
                      if (interval) clearInterval(interval);
                      interval = setInterval(() => {
                        self.postMessage('tick');
                      }, 250);
                    } else if (e.data === 'stop') {
                      if (interval) clearInterval(interval);
                      interval = null;
                    }
                  };
                `], { type: 'application/javascript' });

                const workerUrl = URL.createObjectURL(blob);
                this._worker = new Worker(workerUrl);
                URL.revokeObjectURL(workerUrl);

                this._worker.onmessage = async () => {
                    if (!this.enabled) return;
                    if (this._isSendingProgress) return;
                    if (!this.isConnected && !this._isSettingsOpen) return;

                    // 전역 딜레이 변경 체크
                    if (typeof window.CONFIG !== 'undefined' && window.CONFIG.visual) {
                        if (this.lastConfigDelay === undefined) {
                            this.lastConfigDelay = window.CONFIG.visual.delay;
                        }
                        if (this.lastConfigDelay !== window.CONFIG.visual.delay) {
                            this.lastConfigDelay = window.CONFIG.visual.delay;
                            this.resendWithNewOffset();
                        }
                    }

                    this._isSendingProgress = true;
                    try {
                        const position = Spicetify.Player.getProgress() || 0;
                        const duration = Spicetify.Player.getDuration() || 0;
                        const remaining = (duration - position) / 1000;

                        let currentTrack = null;
                        const currentUri = Spicetify.Player.data?.item?.uri;
                        if (currentUri && this._lastProgressUri !== currentUri) {
                            this._lastProgressUri = currentUri;
                            try {
                                const imageUrl = Spicetify.Player.data?.item?.metadata?.image_xlarge_url
                                    || Spicetify.Player.data?.item?.metadata?.image_url
                                    || Spicetify.Player.data?.item?.metadata?.image_large_url;
                                let albumArt = null;
                                albumArt = resolveSpotifyImageUrl(imageUrl);
                                currentTrack = {
                                    title: Spicetify.Player.data?.item?.metadata?.title || '',
                                    artist: Spicetify.Player.data?.item?.metadata?.artist_name || '',
                                    album: Spicetify.Player.data?.item?.metadata?.album_title || '',
                                    albumArt: albumArt
                                };
                            } catch (e) { }
                        }

                        let nextTrack = null;
                        try {
                            const queue = Spicetify.Queue;
                            if (queue?.nextTracks?.length > 0) {
                                const next = queue.nextTracks[0];
                                if (next?.contextTrack?.metadata) {
                                    const imageUrl = next.contextTrack.metadata.image_url || next.contextTrack.metadata.image_xlarge_url;
                                    const albumArt = resolveSpotifyImageUrl(imageUrl);
                                    nextTrack = {
                                        title: next.contextTrack.metadata.title || '',
                                        artist: next.contextTrack.metadata.artist_name || '',
                                        albumArt: albumArt
                                    };
                                }
                            }
                        } catch (e) { }

                        // 새로운 엔드포인트 사용: /lyrics/progress
                        await this.sendToEndpoint('/lyrics/progress', {
                            position: position,
                            isPlaying: Spicetify.Player.isPlaying() || false,
                            duration: duration,
                            remaining: remaining,
                            currentTrack: currentTrack,
                            nextTrack: nextTrack
                        });
                    } finally {
                        this._isSendingProgress = false;
                    }
                };

                this._worker.postMessage('start');
            }
        },
        stopProgressSync: {
            value: function () {
                if (!this._worker) return;
                cleanupWorker(this._worker);
                this._worker = null;
                this._isSendingProgress = false;
                this._lastProgressUri = null;
            }
        },
        scheduleConnectionCheck: {
            value: function () {
                if (this._connectionCheckTimer) {
                    clearTimeout(this._connectionCheckTimer);
                }

                if (!this.enabled) {
                    this._connectionCheckTimer = null;
                    return;
                }

                this._connectionCheckTimer = setTimeout(() => {
                    this._connectionCheckTimer = null;
                    this.checkConnection();
                }, 1000);
            }
        },
        syncRuntimeState: {
            value: function () {
                const enabled = !!this.enabled;
                if (this._runtimeEnabledState === enabled) {
                    return;
                }

                this._runtimeEnabledState = enabled;
                if (enabled) {
                    this.startProgressSync();
                    this.setupOffsetListener();
                    this.scheduleConnectionCheck();
                } else {
                    this.stopProgressSync();
                    this.teardownOffsetListener();
                    clearSettingsPolling(this);
                    this.lastSentUri = null;
                    this.lastSentLyrics = null;
                    this.lastSentOffset = null;
                    this._lastTrackInfo = null;
                    this._lastLyrics = null;
                    this._offsetCache = {};
                    this.isConnected = false;
                }
            }
        },
        setupRuntimeListener: {
            value: function () {
                if (this._runtimeListenerSetup) return;
                this._runtimeListenerSetup = true;

                this._runtimeStorageListener = () => {
                    this.syncRuntimeState();
                };
                this._runtimeEventListener = () => {
                    this.syncRuntimeState();
                };

                window.addEventListener('storage', this._runtimeStorageListener);
                window.addEventListener('ivLyrics', this._runtimeEventListener);
            }
        },
        teardownRuntimeListener: {
            value: function () {
                if (!this._runtimeListenerSetup) return;
                this._runtimeListenerSetup = false;

                if (this._runtimeStorageListener) {
                    window.removeEventListener('storage', this._runtimeStorageListener);
                    this._runtimeStorageListener = null;
                }
                if (this._runtimeEventListener) {
                    window.removeEventListener('ivLyrics', this._runtimeEventListener);
                    this._runtimeEventListener = null;
                }
                if (this._connectionCheckTimer) {
                    clearTimeout(this._connectionCheckTimer);
                    this._connectionCheckTimer = null;
                }
            }
        },
        checkConnection: {
            value: async function () {
                if (!this.enabled) return false;

                try {
                    // /lyrics/progress 엔드포인트로 연결 확인
                    const response = await fetch(`http://localhost:${this.port}/lyrics/progress`, {
                        method: 'POST',
                        mode: 'cors',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ position: 0, isPlaying: false }),
                        signal: AbortSignal.timeout(1000)
                    });
                    this.isConnected = response.ok;
                    return this.isConnected;
                } catch (e) {
                    this.isConnected = false;
                    return false;
                }
            }
        },
        init: {
            value: function () {
                this.setupRuntimeListener();
                this.syncRuntimeState();
                helperDebug('[lyricsHelperSender] Initialized in Extension');
            }
        },
        destroy: {
            value: function () {
                this.stopProgressSync();
                this.teardownOffsetListener();
                this.teardownRuntimeListener();
                clearSettingsPolling(this);
            }
        }
    });


    window.LyricsService = LyricsService;

    // OverlaySender 초기화 및 전역 등록
    OverlaySender.init();
    window.OverlaySender = OverlaySender;

    lyricsHelperSender.init();
    window.lyricsHelperSender = lyricsHelperSender;

    serviceDebug("[LyricsService] LyricsService Extension initialized successfully!");
    serviceDebug("[LyricsService] Available APIs: window.LyricsService, window.LyricsCache, window.ApiTracker, window.Translator, window.OverlaySender, window.lyricsHelperSender");
})();
