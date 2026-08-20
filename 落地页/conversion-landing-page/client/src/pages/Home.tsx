/**
 * 设计提醒：此页是知乎推广 OPC 的唯一启动入口。
 * 视觉采用“清新运营台”：数据中继、角色授权、信号扫描和珊瑚橘状态点共同表达 Admin／团长／达人的业务协同。
 * 页面只保留一个待配置的门户入口，所有其他动态均用于传达加载与就绪状态。
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Orbit as OrbitIcon, ShieldCheck } from "lucide-react";

const opcMark = "/manus-storage/orbit-mark_d2638064.png";
const controlImage = "/manus-storage/orbit-hero-control-room_9bbc0d7a.jpg";

// 营销门户地址（与落地页同源，由后端静态托管）
const PORTAL_URL = "/portal/";

const loadingStages = [
  { code: "01", label: "核验访问权限", detail: "正在识别 Admin、团长与达人的角色范围" },
  { code: "02", label: "同步知星河业务", detail: "正在连接知乎推广计划与项目数据" },
  { code: "03", label: "构建收益中继", detail: "正在准备收益、订单与结算的处理链路" },
  { code: "04", label: "启动运营门户", detail: "正在加载数据看板、创意工具坊与项目工作台" },
];

const runtimeSignals = [
  { label: "推广计划", meta: "ZHIXINGHE / SYNC" },
  { label: "收益中继", meta: "ORDER · SETTLEMENT" },
  { label: "角色授权", meta: "ADMIN · LEADER · CREATOR" },
];

export default function Home() {
  const [progress, setProgress] = useState(2);
  const [isReady, setIsReady] = useState(false);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const duration = 4300;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const ratio = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - ratio, 1.7);
      setProgress(Math.min(100, Math.round(2 + eased * 98)));
      if (ratio >= 1) {
        window.clearInterval(timer);
        setIsReady(true);
      }
    }, 42);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPulse((value) => (value + 1) % 3), 1400);
    return () => window.clearInterval(timer);
  }, []);

  const activeStageIndex = useMemo(() => Math.min(3, Math.floor(progress / 25)), [progress]);
  const activeStage = loadingStages[activeStageIndex];

  function enterPortal() {
    if (PORTAL_URL) window.location.assign(PORTAL_URL);
  }

  return (
    <main className="relative grid min-h-[100svh] overflow-hidden bg-[#f2f8f5] text-[#123c3d]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_71%_49%,rgba(238,130,91,0.18),transparent_18%),radial-gradient(circle_at_20%_78%,rgba(104,191,174,0.22),transparent_26%),linear-gradient(116deg,#f8fcfa_5%,#eef8f4_62%,#e5f2ee)]" />
      <img src={controlImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.10] mix-blend-multiply" />
      <div className="opc-grid absolute inset-0" />
      <div className="opc-orbit-a absolute right-[7%] top-1/2 h-[770px] w-[770px] -translate-y-1/2 rounded-full border border-[#165f5c]/15" />
      <div className="opc-orbit-b absolute right-[13%] top-1/2 h-[520px] w-[520px] -translate-y-1/2 rounded-full border border-[#165f5c]/20" />
      <div className="opc-drift absolute right-[21%] top-1/2 h-[320px] w-[320px] -translate-y-1/2 rounded-full border border-[#e9805b]/45" />
      <div className="absolute right-[8%] top-1/2 hidden h-[640px] w-[640px] -translate-y-1/2 lg:block" aria-hidden="true">
        <span className="opc-traveler-a absolute h-2 w-2 rounded-full bg-[#e9805b] shadow-[0_0_14px_rgba(233,128,91,0.55)]" />
        <span className="opc-traveler-b absolute h-1.5 w-1.5 rounded-full bg-[#165f5c] shadow-[0_0_12px_rgba(22,95,92,0.4)]" />
      </div>
      <div className="opc-scanline absolute right-[11%] top-[7%] w-[630px] max-w-[56vw]" />
      <div className="absolute left-[12%] top-[16%] h-[2px] w-20 bg-[#e9805b]" />
      <div className="opc-beacon absolute bottom-[17%] right-[18%] h-2.5 w-2.5 rounded-full bg-[#e9805b]" />
      <div className="absolute bottom-[12%] right-[28%] h-1.5 w-1.5 rounded-full bg-[#165f5c]/70" />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10 sm:py-8">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center border border-[#165f5c]/20 bg-[#165f5c]"><img src={opcMark} alt="OPC" className="h-6 w-6 object-contain" /></span>
          <span className="orbit-wordmark text-[#123c3d]" aria-label="OPC">OPC</span>
          <span className="hidden border-l border-[#165f5c]/20 pl-3 font-mono text-[9px] tracking-[0.16em] text-[#5b7b78] sm:block">ZHIHU PROMOTION OPS</span>
        </div>
        <span className="font-mono text-[9px] font-semibold tracking-[0.19em] text-[#5b7b78]">ACCESS GATEWAY / 01</span>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-[1220px] items-center px-6 pb-20 sm:px-10">
        <div className="grid w-full items-center gap-12 lg:grid-cols-[1fr_310px] lg:gap-24">
          {!isReady ? (
            <div className="max-w-[720px]">
              <div className="mb-8 flex items-center gap-3 font-mono text-[10px] font-semibold tracking-[0.21em] text-[#376764]"><span className="opc-beacon h-1.5 w-1.5 rounded-full bg-[#e9805b]" />OPC INITIALIZATION</div>
              <div className="relative mb-9 h-[112px] w-[112px] sm:h-[132px] sm:w-[132px]">
                <div className="loading-ring loading-ring-outer absolute inset-0 rounded-full border border-[#165f5c]/25" />
                <div className="loading-ring loading-ring-inner absolute inset-[17px] rounded-full border border-[#165f5c]/30 sm:inset-[20px]" />
                <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e9805b] shadow-[0_0_28px_10px_rgba(233,128,91,0.32)]" />
                <div className="absolute -right-1 top-[14%] h-2 w-2 rounded-full bg-[#165f5c]" />
              </div>
              <h1 className="font-['Space_Grotesk'] text-[clamp(3rem,7.2vw,6.65rem)] font-semibold leading-[0.88] tracking-[-0.075em]">正在接入<br />知乎推广运营台。</h1>
              <p className="mt-7 max-w-[560px] text-sm leading-7 text-[#527673] sm:text-base">OPC 正在按授权加载知星河业务流程、推广计划、收益数据中继与相应角色的运营工作台。</p>
              <div className="mt-11 max-w-[540px]">
                <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-[0.14em] text-[#527673]"><span>OPERATIONAL PROTOCOL</span><span>{String(progress).padStart(3, "0")} / 100</span></div>
                <div className="relative h-[3px] overflow-hidden bg-[#165f5c]/20"><div className="opc-flow-line relative h-full transition-[width] duration-75 ease-linear" style={{ width: `${progress}%` }}><span className="opc-data-packet absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#e9805b] shadow-[0_0_12px_rgba(233,128,91,0.6)]" /></div></div>
                <div key={activeStage.code} className="opc-stage-flash mt-4 flex items-start gap-2 text-xs leading-5 text-[#527673]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e9805b]" />{activeStage.detail}</div>
              </div>
            </div>
          ) : (
            <div className="ready-enter max-w-[760px]">
              <div className="mb-8 flex items-center gap-3 font-mono text-[10px] font-semibold tracking-[0.21em] text-[#376764]"><span className="grid h-5 w-5 place-items-center rounded-full border border-[#e9805b]/80 text-[#d66d4b]"><Check size={12} strokeWidth={2.6} /></span>OPERATIONAL ENVIRONMENT READY</div>
              <div className="relative mb-9 h-[112px] w-[112px] sm:h-[132px] sm:w-[132px]">
                <div className="opc-breathe absolute inset-0 rounded-full border border-[#e9805b]/75" />
                <div className="absolute inset-[17px] rounded-full border border-[#165f5c]/30 sm:inset-[20px]" />
                <div className="opc-beacon absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#e9805b] text-[#133a3b]"><OrbitIcon size={23} /></div>
              </div>
              <h1 className="font-['Space_Grotesk'] text-[clamp(3.15rem,7.6vw,6.85rem)] font-semibold leading-[0.88] tracking-[-0.075em]">知乎推广工作台<br /><span className="text-[#d66d4b]">已准备就绪。</span></h1>
              <p className="mt-7 max-w-[600px] text-sm leading-7 text-[#527673] sm:text-base">管理后台将按角色权限提供数据看板、订单与结算、推广计划、关键词回传、创意工具坊及知乎故事项目管理能力。</p>
              <div className="mt-11 flex items-center gap-5">
                <button type="button" onClick={enterPortal} className="group inline-flex h-[54px] items-center gap-3 border border-[#d66d4b] bg-[#e9805b] px-5 text-sm font-bold text-[#123c3d] transition duration-200 hover:bg-[#f09b79] active:scale-[0.97]">
                  进入 OPC 门户 <ArrowUpRight size={17} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
                <span className="font-mono text-[10px] tracking-[0.12em] text-[#6b8b87]">PORTAL / ONLINE</span>
              </div>
            </div>
          )}

          <aside className="hidden border-l border-[#165f5c]/20 pl-7 lg:block">
            <div className="mb-6 flex items-center justify-between"><span className="font-mono text-[9px] font-semibold tracking-[0.18em] text-[#527673]">RUNTIME SIGNALS</span><ShieldCheck size={15} className="text-[#d66d4b]" /></div>
            <div className="space-y-0 border-y border-[#165f5c]/20">
              {runtimeSignals.map((signal, index) => (
                <div key={signal.label} className={`opc-rise ${index === 1 ? "opc-rise-delay" : ""} ${index === activeStageIndex % 3 ? "opc-signal-active" : ""} flex items-center justify-between gap-4 border-b border-[#165f5c]/15 py-5 last:border-b-0`}>
                  <div className="min-w-0"><div className="flex items-center gap-3"><span className="font-mono text-[10px] text-[#6b8b87]">0{index + 1}</span><span className="text-sm text-[#183f40]">{signal.label}</span></div><p className="mt-1.5 font-mono text-[8px] tracking-[0.1em] text-[#6b8b87]">{signal.meta}</p></div>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] tracking-[0.12em] text-[#527673]"><span className={`h-1.5 w-1.5 rounded-full ${index === activeStageIndex % 3 ? "opc-beacon bg-[#e9805b]" : "bg-[#6b8b87]"}`} />{isReady ? "READY" : "SYNC"}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 font-mono text-[10px] leading-6 tracking-[0.12em] text-[#6b8b87]">{isReady ? "ROLE ACCESS STANDING BY" : `${activeStage.code} / ${activeStage.label.toUpperCase()}`}<br />PULSE {String(pulse + 1).padStart(2, "0")}</div>
          </aside>
        </div>
      </section>

      <footer className="relative z-10 flex items-center justify-between px-6 py-6 font-mono text-[9px] tracking-[0.14em] text-[#6b8b87] sm:px-10 sm:py-8"><span>OPC / ZHIHU PROMOTION OPS</span><span>{isReady ? "STATUS: STANDING BY" : `STATUS: ${activeStage.label.toUpperCase()}`}</span></footer>
    </main>
  );
}
