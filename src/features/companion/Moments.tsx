import { useEffect, useRef, useState } from 'react';
import { Hand, Sparkles, Star, X } from 'lucide-react';
import type { Emotion, PetAction } from '../../types';
import { momentOffers, type MomentId } from '../../life';

export interface MomentResult {
  outcome: string;
  line: string;
  emotion: Emotion;
  action: PetAction;
}
/** She acts the moment out: hides the star, cheers a catch, reads from her book. */
export type MomentAct = (action: PetAction, emotion?: Emotion) => void;
interface Props {
  id: MomentId;
  name: string;
  reducedMotion: boolean;
  onDone: (result: MomentResult) => void;
  onClose: () => void;
  onAct?: MomentAct;
  /** On the desktop pet: a small bubble above her, stars falling around her instead of a card. */
  compact?: boolean;
}
const still: MomentAct = () => {};

const desserts = [
  { name: '草莓蛋糕', line: '草莓蛋糕！最上面那颗草莓……就让给你吧♪' },
  { name: '抹茶团子', line: '抹茶团子软软的，配上一点点苦味，刚刚好。' },
  { name: '热可可', line: '热可可要小口喝哦，暖到手心里了吧？' },
];
// Original short passages written for Mori; read aloud by the character, not attributed quotes.
const passages = [
  '傍晚的风把云吹得很薄，像有人在天上轻轻写字。写到一半停住了，大概是想等星星来接着写。',
  '雨停以后，窗台上留着一小洼光。麻雀来喝了一口，又飞走了，好像只是来确认今天还在。',
  '有些话不用一次说完。像一壶慢慢泡开的茶，留一点给明天，味道会更好。',
  '路灯一盏一盏亮起来的时候，城市像在数自己有多少个温柔的角落。',
  '今天也有很多没做完的事。可是没关系，花也不是一夜之间开好的。',
  '如果把今天折成一只纸船，放进心里的小河，它会慢慢漂到想去的地方。',
];
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

export function Moment({ id, name, reducedMotion, onDone, onClose, onAct = still, compact = false }: Props) {
  return (
    <section
      className={`moment-card ${compact ? 'compact' : ''}`}
      role="dialog"
      aria-label={momentOffers[id].title}
    >
      <header>
        <strong>{momentOffers[id].title}</strong>
        <button className="moment-close" aria-label="结束这个小活动" onClick={onClose}>
          <X size={compact ? 13 : 16} />
        </button>
      </header>
      {id === 'snack' && <Snack name={name} onDone={onDone} onAct={onAct} />}
      {id === 'guess' && <Guess name={name} onDone={onDone} onAct={onAct} />}
      {id === 'stars' && <Stars name={name} reducedMotion={reducedMotion} onDone={onDone} onAct={onAct} />}
      {id === 'read' && <ReadTogether name={name} onDone={onDone} onAct={onAct} />}
    </section>
  );
}
type Part = { name: string; onDone: Props['onDone']; onAct: MomentAct };

function Snack({ name, onDone, onAct }: Part) {
  // She considers the plates while you choose.
  useEffect(() => onAct('idle', 'thinking'), [onAct]);
  return (
    <>
      <p>{name}拿出了三样点心，你想分享哪一样？</p>
      <div className="moment-choices">
        {desserts.map((dessert) => (
          <button
            key={dessert.name}
            onClick={() =>
              onDone({
                outcome: `分享了${dessert.name}`,
                line: dessert.line,
                emotion: 'happy',
                action: 'snack',
              })
            }
          >
            {dessert.name}
          </button>
        ))}
      </div>
    </>
  );
}

function Guess({ name, onDone, onAct }: Part) {
  const rounds = 3;
  const [round, setRound] = useState(0);
  const [hits, setHits] = useState(0);
  const [result, setResult] = useState('');
  // Between a guess and the next round she shows the hand; no guessing meanwhile.
  const [revealing, setRevealing] = useState(false);
  const hand = useRef<'left' | 'right'>(Math.random() < 0.5 ? 'left' : 'right');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Hands together, the star hidden in one of them.
  useEffect(() => {
    onAct('listen', 'neutral');
    return () => clearTimeout(timer.current);
  }, [onAct]);
  function guess(choice: 'left' | 'right') {
    if (revealing) return;
    const hit = choice === hand.current;
    const total = hits + (hit ? 1 : 0);
    setHits(total);
    setResult(hit ? '猜中啦！星星就在这只手里。' : `是另一只手哦～`);
    // A little jump for a right guess, a playful head shake for a wrong one.
    onAct(hit ? 'bounce' : 'shake', hit ? 'happy' : 'surprised');
    hand.current = Math.random() < 0.5 ? 'left' : 'right';
    if (round + 1 < rounds) {
      setRevealing(true);
      timer.current = setTimeout(() => {
        setRevealing(false);
        setResult('');
        onAct('listen', 'neutral');
      }, 1500);
    }
    if (round + 1 >= rounds)
      setTimeout(
        () =>
          onDone({
            outcome: `三局猜中 ${total} 次`,
            line:
              total === 3
                ? '三次全中？你是不是偷偷看见了！'
                : total === 0
                  ? '一次都没猜中……那这颗星星，就当作我送你的安慰奖吧。'
                  : `猜中了 ${total} 次，很厉害嘛。下次我要藏得更好一点。`,
            emotion: total === 0 ? 'thinking' : total === 3 ? 'surprised' : 'happy',
            action: 'bounce',
          }),
        700,
      );
    setRound(round + 1);
  }
  return (
    <>
      <p>
        {result ||
          (round < rounds
            ? `${name}双手合起来藏好了星星——第 ${round + 1} / ${rounds} 局，在哪只手里？`
            : '数一数结果……')}
        <span className="moment-meta">已猜中 {hits} 次</span>
      </p>
      {round < rounds && (
        <div className="moment-choices">
          <button disabled={revealing} onClick={() => guess('left')}>
            <Hand size={16} /> 左手
          </button>
          <button disabled={revealing} onClick={() => guess('right')}>
            <Hand size={16} style={{ transform: 'scaleX(-1)' }} /> 右手
          </button>
        </div>
      )}
    </>
  );
}

function Stars({ name, reducedMotion, onDone, onAct }: Part & { reducedMotion: boolean }) {
  const length = 20;
  const [left, setLeft] = useState(length);
  const [score, setScore] = useState(0);
  const [stars, setStars] = useState<{ id: number; x: number; delay: number }[]>([]);
  const next = useRef(0);
  const scoreRef = useRef(0);
  const finished = useRef(false);
  // She watches the sky with you, and cheers every fifth star.
  useEffect(() => onAct('listen', 'happy'), [onAct]);
  useEffect(() => {
    if (!score || score % 5) return;
    onAct('bounce', 'happy');
    const back = setTimeout(() => onAct('listen', 'happy'), 1300);
    return () => clearTimeout(back);
  }, [score, onAct]);
  useEffect(() => {
    const spawn = setInterval(() => {
      setStars((items) => [...items.slice(-14), { id: next.current++, x: 6 + Math.random() * 88, delay: 0 }]);
    }, 650);
    const clock = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => {
      clearInterval(spawn);
      clearInterval(clock);
    };
  }, []);
  useEffect(() => {
    if (left > 0 || finished.current) return;
    finished.current = true;
    const total = scoreRef.current;
    onDone({
      outcome: `20 秒接到 ${total} 颗星星`,
      line:
        total >= 18
          ? `${total} 颗！你接星星的样子，好像真的会把夜空装进口袋里。`
          : total >= 8
            ? `接到 ${total} 颗呢，我们把它们串成项链吧♪`
            : `${total} 颗也很好呀，每一颗都是你亲手接住的。`,
      emotion: total >= 8 ? 'happy' : 'neutral',
      action: 'wave',
    });
  }, [left, onDone]);
  return (
    <>
      <p>
        点住落下的星星！
        <span className="moment-meta">
          剩余 {left} 秒 · 已接 {score} 颗
        </span>
      </p>
      <div className={`star-field ${reducedMotion ? 'still' : ''}`} aria-label={`${name}和你一起接星星`}>
        {stars.map((star) => (
          <button
            key={star.id}
            className="falling-star"
            style={{ left: `${star.x}%` }}
            aria-label="接住星星"
            onClick={() => {
              scoreRef.current++;
              setScore(scoreRef.current);
              setStars((items) => items.filter((item) => item.id !== star.id));
            }}
          >
            <Star size={22} />
          </button>
        ))}
      </div>
    </>
  );
}

function ReadTogether({ name, onDone, onAct }: Part) {
  const [passage, setPassage] = useState(() => pick(passages));
  // She reads from her book while the passage is shown.
  useEffect(() => onAct('read', 'neutral'), [onAct]);
  return (
    <>
      <p className="moment-intro">{name}清了清嗓子，轻声念道：</p>
      <blockquote className="moment-passage">{passage}</blockquote>
      <div className="moment-choices">
        <button
          onClick={() =>
            onDone({
              outcome: `读了一段：「${passage.slice(0, 18)}…」`,
              line: '我很喜欢这一段。下次换你挑一段念给我听，好不好？',
              emotion: 'happy',
              action: 'nod',
            })
          }
        >
          <Sparkles size={15} /> 好温柔
        </button>
        <button onClick={() => setPassage((current) => pick(passages.filter((item) => item !== current)))}>
          再念一段
        </button>
      </div>
    </>
  );
}
