/**
 * OPC「运营信号台」：瑞士编辑排版、雾白/墨黑/信号橙，错位信息工作台布局。
 * 任何新增元素都应增强“可校准、可追踪、可推进”的增长运营感。
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Layers3,
  Menu,
  MoveUpRight,
  Orbit,
  ScanLine,
  X,
} from "lucide-react";

// 三端登录入口（生产同源子路径；本地联调时改为 http://localhost:530X/login）
const LOGIN_ENTRIES = [
  { key: "leader", label: "我是团长", code: "LEADER / 01", desc: "团队运营与成员管理", url: "/leader/login" },
  { key: "creator", label: "我是达人", code: "CREATOR / 02", desc: "推广执行与收益查看", url: "/creator/login" },
  { key: "admin", label: "通行证", code: "ADMIN / 00", desc: "系统管理员总控台", url: "/admin/login" },
];

const navigation = [
  { label: "项目能力", href: "#capabilities" },
  { label: "业务流程", href: "#method" },
  { label: "三端协作", href: "#contact" },
];

const serviceLines = [
  {
    number: "01",
    title: "推广计划管理",
    text: "以计划承载单个或批量关键词，让每一轮知乎推广从一开始就有清晰的操作坐标。",
    icon: ScanLine,
  },
  {
    number: "02",
    title: "关键词绑定",
    text: "通过标准 .xlsx 模板批量入库，支持知乎回答、文章与付费专栏章节等内容地址。",
    icon: Layers3,
  },
  {
    number: "03",
    title: "作品链接回传",
    text: "作品发布后，按关键词或计划 ID 回传链接，在通知中确认结果并处理异常反馈。",
    icon: Orbit,
  },
];

const checkpoints = [
  ["00", "创建计划", "建立本轮推广任务"],
  ["01", "批量绑词", "按模板上传关键词与内容地址"],
  ["02", "作品回传", "按关键词或计划 ID 提交链接"],
  ["03", "结果处理", "查看通知、导出结果并继续调整"],
];

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const [loginPickerOpen, setLoginPickerOpen] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setPageReady(true);
      setShowLoader(false);
      return;
    }

    const readyTimer = window.setTimeout(() => setPageReady(true), 620);
    const removeLoaderTimer = window.setTimeout(() => setShowLoader(false), 1080);
    return () => {
      window.clearTimeout(readyTimer);
      window.clearTimeout(removeLoaderTimer);
    };
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealItems = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (reduceMotion) {
      revealItems.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (reduceMotion || !isDesktop) return;

    const frames = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
    let frameId = 0;
    const updateParallax = () => {
      frameId = 0;
      const viewportCenter = window.innerHeight / 2;
      frames.forEach((frame) => {
        const rect = frame.getBoundingClientRect();
        const strength = Number(frame.dataset.parallax ?? "12");
        const progress = Math.max(-1, Math.min(1, (viewportCenter - (rect.top + rect.height / 2)) / window.innerHeight));
        frame.style.setProperty("--parallax-y", `${Math.round(progress * strength)}px`);
      });
    };
    const requestUpdate = () => {
      if (!frameId) frameId = window.requestAnimationFrame(updateParallax);
    };
    updateParallax();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  const handleHeroPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const frame = event.currentTarget;
    const rect = frame.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    frame.style.setProperty("--tilt-x", `${(-y * 3.2).toFixed(2)}deg`);
    frame.style.setProperty("--tilt-y", `${(x * 3.8).toFixed(2)}deg`);
    frame.style.setProperty("--shine-x", `${((x + 0.5) * 100).toFixed(1)}%`);
    frame.style.setProperty("--shine-y", `${((y + 0.5) * 100).toFixed(1)}%`);
  };

  const resetHeroPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
    event.currentTarget.style.setProperty("--shine-x", "50%");
    event.currentTarget.style.setProperty("--shine-y", "50%");
  };

  return (
    <div className={`app-shell motion-enabled min-h-screen overflow-x-clip bg-[#f4f1ea] text-[#171716] ${pageReady ? "is-ready" : "is-loading"}`}>
      {showLoader && (
        <div className={`page-loader ${pageReady ? "is-exiting" : ""}`} role="status" aria-label="正在载入 OPC 增长工作台">
          <div className="loader-content">
            <div className="loader-mark"><img src="/manus-storage/opc-brand-mark_b5c33787.png" alt="" /></div>
            <div className="loader-copy"><span>OPC / INITIALIZING</span><span>GROWTH SIGNAL</span></div>
            <div className="loader-meter"><i /></div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-50 border-b border-[#171716]/10 bg-[#f4f1ea]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12" data-reveal data-delay="1">
          <a href="#top" className="group flex items-center gap-3" aria-label="OPC 返回顶部">
            <img
              src="/manus-storage/opc-brand-mark_b5c33787.png"
              alt=""
              className="h-11 w-11 transition-transform duration-200 group-hover:rotate-[-8deg] group-active:scale-95"
            />
            <span className="engineered-wordmark" aria-label="OPC"><span>O</span><i /><span>PC</span></span>
            <span className="hidden border-l border-[#171716]/25 pl-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#171716]/55 sm:inline">
              Zhihu Promotion OS
            </span>
          </a>

          <nav className="hidden items-center gap-8 md:flex" aria-label="主导航">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} className="nav-link">
                {item.label}
              </a>
            ))}
          </nav>

          <button type="button" onClick={() => setLoginPickerOpen(true)} className="signal-button hidden md:inline-flex">
            登录到 OPC 工作台 <ArrowUpRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center border border-[#171716]/15 md:hidden"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "关闭导航" : "打开导航"}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <nav className="border-t border-[#171716]/10 bg-[#f4f1ea] px-5 py-5 md:hidden" aria-label="移动端导航">
            <div className="flex flex-col gap-3">
              {navigation.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between border-b border-[#171716]/10 pb-3 font-display text-xl font-semibold"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label} <ArrowUpRight className="h-4 w-4 text-[#ff5a1f]" />
                </a>
              ))}
              <button type="button" className="signal-button mt-2 justify-center" onClick={() => { setMobileMenuOpen(false); setLoginPickerOpen(true); }}>
                登录到 OPC 工作台 <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </nav>
        )}
      </header>

      <main id="top">
        <section className="relative mx-auto max-w-[1440px] px-5 pb-16 pt-8 sm:px-8 sm:pb-24 lg:px-12 lg:pb-28 lg:pt-12">
          <div className="mb-7 flex items-center justify-between border-y border-[#171716]/10 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#171716]/60" data-reveal data-delay="1">
            <span className="flex items-center gap-2"><i className="signal-dot" /> Project Flow / 01</span>
            <span>Plan · Keyword · Return</span>
          </div>

          <div className="grid gap-10 lg:grid-cols-[0.94fr_1.06fr] lg:items-end lg:gap-14">
            <div className="relative z-10 pt-2 lg:pb-4">
              <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ff5a1f]" data-reveal data-delay="2">Knowledge River / Zhihu Promotion</p>
              <h1 className="font-display max-w-[720px] text-[clamp(3.45rem,7.4vw,7.7rem)] font-semibold leading-[0.89] tracking-[-0.075em]" data-reveal data-delay="3">
                让知乎推广<br />
                <span className="text-[#ff5a1f]">跑进同一条链路。</span>
              </h1>
              <div className="mt-9 max-w-lg border-l-2 border-[#ff5a1f] pl-5" data-reveal data-delay="4">
                <p className="text-lg leading-8 text-[#353532] sm:text-xl">
                  知星河把推广计划、关键词绑定与作品链接回传串成一套可执行的运营流程，让每次发布都有据可循。
                </p>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-4" data-reveal data-delay="5">
                <button type="button" onClick={() => setLoginPickerOpen(true)} className="signal-button">
                  登录到 OPC 工作台 <ArrowUpRight className="h-4 w-4" />
                </button>
                <a href="#method" className="text-link">
                  查看运营流程 <ArrowDown className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div className="parallax-frame hero-parallax" data-parallax="26" data-reveal data-delay="4" onPointerMove={handleHeroPointerMove} onPointerLeave={resetHeroPointer}>
              <figure className="hero-figure group relative overflow-hidden border border-[#171716]/15 bg-[#d9d8d2]">
                <img
                  src="/manus-storage/opc-hero-signal_43b39f64.jpg"
                  alt="由增长轨迹、校准线与运营面板构成的 OPC 信号系统抽象视觉"
                  className="h-[350px] w-full object-cover object-center transition duration-700 group-hover:scale-[1.03] sm:h-[480px] lg:h-[570px]"
                  fetchPriority="high"
                />
                <div className="hero-orbit hero-orbit-one" aria-hidden="true" />
                <div className="hero-orbit hero-orbit-two" aria-hidden="true" />
                <div className="hero-shine" aria-hidden="true" />
                <div className="hero-scan-line" aria-hidden="true" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#171716]/40 via-transparent to-transparent" />
                <div className="absolute left-4 top-4 flex items-center gap-2 bg-[#f4f1ea]/92 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#171716] backdrop-blur sm:left-6 sm:top-6">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#ff5a1f]" /> Workflow online
                </div>
                <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-4 text-[#f4f1ea] sm:p-6">
                  <span className="font-mono text-[10px] uppercase tracking-[0.13em]">Current core / Plan · Bind · Return</span>
                  <span className="font-display text-2xl font-semibold tracking-[-0.08em]">O1</span>
                </div>
                <span className="image-calibration absolute bottom-[16%] right-4 sm:right-6">ZHI XING HE · 01</span>
                <div className="absolute right-0 top-0 hidden h-full w-px bg-[#f4f1ea]/55 sm:block" />
              </figure>
            </div>
          </div>

          <div className="mt-9 grid border-y border-[#171716]/10 py-4 sm:grid-cols-3 sm:py-5" data-reveal data-delay="5">
            {[
              ["计划", "从关键词建立本次推广任务"],
              ["绑定", "批量上传内容地址并完成入库"],
              ["回传", "发布后回传链接并确认结果"],
            ].map(([title, detail], index) => (
              <div key={title} className={`flex gap-4 px-0 py-3 sm:px-6 sm:py-0 ${index ? "sm:border-l sm:border-[#171716]/10" : ""}`}>
                <span className="font-mono text-[10px] text-[#ff5a1f]">0{index + 1}</span>
                <p className="text-sm leading-5 text-[#4c4b47]"><strong className="mr-2 font-semibold text-[#171716]">{title}</strong>{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="capabilities" className="relative isolate overflow-hidden border-y border-[#171716] bg-[#171716] text-[#f4f1ea]">
          <svg className="capability-route" viewBox="0 0 1440 720" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-30 560 C220 470 350 620 575 486 S920 300 1150 380 S1330 260 1470 170" />
            <circle cx="575" cy="486" r="7" /><circle cx="1150" cy="380" r="7" />
          </svg>
          <div className="relative z-10 mx-auto max-w-[1440px] px-5 py-18 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div className="mb-14 grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end" data-reveal>
              <div>
                <p className="section-kicker text-[#ff7a4b]">Current Core / 03 · Zhihu workflow</p>
                <h2 className="font-display mt-5 max-w-md text-4xl font-semibold leading-[0.94] tracking-[-0.065em] sm:text-5xl">
                  从关键词入库，<br />到作品回传。
                </h2>
              </div>
              <p className="max-w-xl text-lg leading-8 text-[#f4f1ea]/72 sm:text-xl">
                知星河围绕知乎推广的核心 SOP，帮助运营团队把计划创建、关键词绑定和发布回传放在一套连续的操作面里。
              </p>
            </div>

            <div className="border-t border-[#f4f1ea]/25">
              {serviceLines.map((service) => {
                const Icon = service.icon;
                return (
                  <article key={service.number} className="service-row group grid gap-5 border-b border-[#f4f1ea]/25 py-8 sm:grid-cols-[72px_1fr_auto] sm:items-center sm:gap-8 sm:py-10" data-reveal data-delay={service.number}>
                    <span className="flex items-center gap-2 font-mono text-xs text-[#ff7a4b]"><i className="route-tick" />{service.number}</span>
                    <div className="grid gap-4 lg:grid-cols-[minmax(190px,0.7fr)_1.3fr] lg:items-center lg:gap-12">
                      <h3 className="font-display text-3xl font-semibold tracking-[-0.06em] sm:text-4xl">{service.title}</h3>
                      <p className="max-w-md text-base leading-7 text-[#f4f1ea]/65">{service.text}</p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center border border-[#f4f1ea]/25 transition duration-200 group-hover:border-[#ff5a1f] group-hover:bg-[#ff5a1f] group-hover:text-[#171716]">
                      <Icon className="h-5 w-5" />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="signal-grid relative overflow-hidden bg-[#e5e4de]">
          <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-18 sm:px-8 sm:py-24 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-20 lg:px-12 lg:py-32">
            <div className="relative z-10" data-reveal>
              <p className="section-kicker">One workflow, less friction</p>
              <h2 className="font-display mt-5 max-w-3xl text-4xl font-semibold leading-[0.94] tracking-[-0.065em] sm:text-6xl">
                把一次发布，<br />放回完整运营流程。
              </h2>
              <p className="mt-8 max-w-xl text-lg leading-8 text-[#4c4b47]">
                从下载模板、批量绑定关键词，到作品发布后回传链接并查看通知结果，知星河让每个操作节点都能顺着同一条业务线推进。
              </p>
              <a href="#method" className="text-link mt-9">
                查看四步推广流程 <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="parallax-frame" data-parallax="34" data-reveal data-delay="2">
              <figure className="interactive-image relative border border-[#171716]/15 bg-[#cbc9c0] p-3 sm:p-5">
                <img
                  src="/manus-storage/opc-strategy-scan_09f91206.jpg"
                  alt="由研究纸张、透明描图纸与信号橙标记组成的策略校准工作台"
                  className="aspect-[1.25/1] w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute -bottom-4 -left-3 bg-[#ff5a1f] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#171716] sm:-bottom-5 sm:-left-5 sm:px-5 sm:py-4">
                Template / .xlsx
                </div>
                <span className="image-calibration absolute right-5 top-5">Axis / keyword ↔ work</span>
              </figure>
            </div>
          </div>
        </section>

        <section id="method" className="bg-[#f4f1ea]">
          <div className="mx-auto max-w-[1440px] px-5 py-18 sm:px-8 sm:py-24 lg:px-12 lg:py-32">
            <div className="mb-12 flex flex-col justify-between gap-6 lg:flex-row lg:items-end" data-reveal>
              <div>
                <p className="section-kicker">Operating Method / 04</p>
                <h2 className="font-display mt-5 text-4xl font-semibold leading-[0.94] tracking-[-0.065em] sm:text-6xl">
                  一条知乎推广 SOP，四步跑通。
                </h2>
              </div>
              <p className="max-w-md text-base leading-7 text-[#4c4b47]">
                每个节点都有明确的输入与结果：从计划与关键词开始，到发布链接回传和结果处理结束，减少跨表格、跨页面的协作摩擦。
              </p>
            </div>

            <div className="method-track relative grid gap-0 border-t border-[#171716]/15 md:grid-cols-4">
              {checkpoints.map(([number, title, detail], index) => (
                <article key={number} className="group relative border-b border-[#171716]/15 py-7 md:border-b-0 md:border-r md:px-7 md:py-10 first:md:pl-0 last:md:border-r-0" data-reveal data-delay={index + 1}>
                  <div className="mb-16 flex items-center justify-between md:mb-24">
                    <span className="font-mono text-xs text-[#ff5a1f]">{number}</span>
                    <span className={`process-node h-3 w-3 border border-[#171716] ${index === 3 ? "bg-[#ff5a1f]" : "bg-[#f4f1ea]"}`} />
                  </div>
                  <h3 className="font-display text-3xl font-semibold tracking-[-0.06em]">{title}</h3>
                  <p className="mt-3 max-w-[180px] text-sm leading-6 text-[#5d5b55]">{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#cbd1cc]">
          <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[1.12fr_0.88fr]">
            <div className="parallax-frame" data-parallax="30" data-reveal>
              <figure className="interactive-image relative min-h-[300px] overflow-hidden bg-[#353632] sm:min-h-[390px]">
                <img
                  src="/manus-storage/opc-process-trajectory_4b48443e.jpg"
                  alt="一条穿过多层架构面板的信号橙增长轨迹"
                  className="absolute inset-0 h-full w-full object-cover transition duration-700 hover:scale-[1.03]"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-[#171716]/10" />
                <div className="absolute bottom-6 left-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#f4f1ea] sm:bottom-8 sm:left-8">
                  01 — 02 — 03 — 04
                </div>
                <span className="image-calibration absolute right-5 top-5 border-[#f4f1ea]/50 text-[#f4f1ea]">Workflow / return</span>
              </figure>
            </div>
            <div className="flex flex-col justify-between p-7 sm:p-12 lg:p-16" data-reveal data-delay="2">
              <MoveUpRight className="h-8 w-8 text-[#ff5a1f]" />
              <div className="mt-20">
                <p className="section-kicker">Built for three roles</p>
                <h2 className="font-display mt-5 text-4xl font-semibold leading-[0.94] tracking-[-0.065em] sm:text-5xl">
                  让管理员、团长与达人，<br />围绕同一条业务线协作。
                </h2>
                <p className="mt-6 max-w-md text-base leading-7 text-[#444742]">
                  知星河以知乎推广为核心，连接不同角色的计划、数据与操作视角；更多账户和后台能力将随重构逐步接入。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="contact" className="relative isolate overflow-hidden bg-[#ff5a1f] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-32">
          <div className="cta-signal-field" aria-hidden="true" />
          <div className="mx-auto max-w-[1440px]" data-reveal>
            <p className="section-kicker text-[#171716]/75">Start a promotion plan / OPC</p>
            <div className="mt-7 grid gap-10 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
              <h2 className="font-display max-w-4xl text-[clamp(3.3rem,7.2vw,7.5rem)] font-semibold leading-[0.87] tracking-[-0.078em] text-[#171716]">
                从一个推广计划，<br />开始跑通知乎运营流程。
              </h2>
              <div className="lg:pb-2">
                <p className="max-w-md text-lg leading-8 text-[#171716]/78">
                  进入 OPC 工作台，创建推广计划、批量绑定关键词，并在作品发布后按关键词或计划 ID 回传链接。
                </p>
                <button type="button" onClick={() => setLoginPickerOpen(true)} className="dark-button mt-8">
                  登录到 OPC 工作台 <ArrowUpRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#171716] text-[#f4f1ea]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-5 py-9 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12" data-reveal>
          <div>
            <div className="flex items-center gap-3">
              <img src="/manus-storage/opc-brand-mark_b5c33787.png" alt="" className="h-10 w-10" />
              <span className="engineered-wordmark light" aria-label="OPC"><span>O</span><i /><span>PC</span></span>
            </div>
            <p className="mt-4 text-sm text-[#f4f1ea]/55">把知乎推广，放进有序运营流程。</p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-[#f4f1ea]/55 sm:flex-row sm:gap-8">
            <a href="#top" className="footer-link">返回顶部</a>
            <a href="mailto:hello@opc.team" className="footer-link">hello@opc.team</a>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]">© 2026 OPC · 知星河</span>
          </div>
        </div>
      </footer>

      {loginPickerOpen && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-[#171716]/45 px-4 backdrop-blur-[2px]"
          onClick={() => setLoginPickerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="选择登录身份"
        >
          <div
            className="w-full max-w-[440px] border border-[#171716]/12 bg-[#f7f5f1] shadow-[0_24px_64px_rgba(23,23,22,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#171716]/10 px-6 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#171716]/55">Access Gateway · 选择身份入口</p>
              <button
                type="button"
                onClick={() => setLoginPickerOpen(false)}
                className="flex h-8 w-8 items-center justify-center border border-[#171716]/15 text-[#171716]/60 transition-colors hover:border-[#ff5a1f] hover:text-[#ff5a1f]"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              {LOGIN_ENTRIES.map((entry) => (
                <a
                  key={entry.key}
                  href={entry.url}
                  className="group flex items-center justify-between gap-4 border-b border-[#171716]/10 px-6 py-5 transition-colors last:border-b-0 hover:bg-[#efede8]"
                >
                  <span>
                    <span className="block font-display text-xl font-semibold text-[#171716]">{entry.label}</span>
                    <span className="mt-1 block text-xs text-[#171716]/55">{entry.desc}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#171716]/40">{entry.code}</span>
                    <ArrowUpRight className="h-4 w-4 text-[#171716]/40 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#ff5a1f]" />
                  </span>
                </a>
              ))}
            </div>
            <p className="border-t border-[#171716]/10 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[#171716]/40">
              账号由管理员开通 · 忘记密码请联系管理员重置
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
