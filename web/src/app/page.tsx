"use client";

import { Link } from "react-router-dom";
import {
  ArrowRight,
  Brush,
  CreditCard,
  ImagePlus,
  Layers3,
  Sparkles,
  Upload,
  WalletCards,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const newAPIBaseURL = "https://fps.de5.net";
const registerURL = `${newAPIBaseURL}/register`;
const rechargeURL = `${newAPIBaseURL}/topup`;

const featureCards = [
  {
    title: "文生图",
    description: "输入提示词后直接生成图片，支持多比例、并行任务和高质量输出。",
    icon: Wand2,
  },
  {
    title: "图生图",
    description: "上传参考图继续改图，适合二次创作、风格延展和局部重绘。",
    icon: Upload,
  },
  {
    title: "会话历史",
    description: "生成结果会沉淀为会话，方便继续编辑、下载或回看提示词。",
    icon: Layers3,
  },
  {
    title: "按成功扣费",
    description: "普通用户使用 NewAPI 余额结算，只有成功出图才扣费。",
    icon: CreditCard,
  },
] as const;

const steps = [
  ["注册账号", "跳转 fps.de5.net 注册 NewAPI 账号。"],
  ["充值余额", "在 NewAPI 充值后回到本页面登录。"],
  ["开始生图", "进入图片工作台，选择比例、数量和参考图。"],
] as const;

export default function HomePage() {
  return (
    <div className="h-full overflow-y-auto rounded-[32px] border border-stone-200 bg-[#f8f7f1] text-stone-950 shadow-[0_24px_90px_rgba(55,48,35,0.10)] dark:border-[var(--studio-border)] dark:bg-[var(--studio-bg)] dark:text-[var(--studio-text-strong)]">
      <div className="relative isolate min-h-full overflow-hidden">
        <div className="absolute left-[-12%] top-[-18%] -z-10 h-[420px] w-[420px] rounded-full bg-[#d7f0c3] blur-3xl opacity-80 dark:bg-white/10" />
        <div className="absolute right-[-8%] top-[12%] -z-10 h-[360px] w-[360px] rounded-full bg-[#ffd6a8] blur-3xl opacity-75 dark:bg-stone-500/20" />
        <div className="absolute bottom-[-18%] left-[20%] -z-10 h-[380px] w-[520px] rotate-[-8deg] rounded-[999px] bg-[#b9d9ff] blur-3xl opacity-60 dark:bg-stone-700/30" />

        <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-stone-950 text-white shadow-sm dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
              <Sparkles className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight">ChatGpt Image Studio</span>
              <span className="block truncate text-xs text-stone-500 dark:text-[var(--studio-text-muted)]">
                fps.de5.net 账号通用
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="hidden rounded-2xl border-stone-300 bg-white/70 px-4 sm:inline-flex">
              <a href={registerURL} target="_blank" rel="noreferrer">
                注册
              </a>
            </Button>
            <Button asChild className="rounded-2xl bg-stone-950 px-4 text-white hover:bg-stone-800">
              <Link to="/login">登录</Link>
            </Button>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-[1180px] gap-8 px-5 pb-10 pt-4 sm:px-8 lg:grid-cols-[1.04fr_0.96fr] lg:px-10 lg:pb-16 lg:pt-10">
          <div className="flex flex-col justify-center">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-200 bg-white/75 px-3 py-2 text-xs font-medium text-stone-600 shadow-sm dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)] dark:text-[var(--studio-text)]">
              <span className="size-2 rounded-full bg-emerald-500" />
              NewAPI 账号登录，余额统一结算
            </div>

            <h1 className="mt-6 max-w-[760px] text-[44px] font-semibold leading-[1.02] tracking-[-0.06em] text-stone-950 sm:text-[64px] lg:text-[78px] dark:text-[var(--studio-text-strong)]">
              一个更直接的
              <span className="block text-stone-500 dark:text-[var(--studio-text-muted)]">AI 生图工作台。</span>
            </h1>

            <p className="mt-6 max-w-[640px] text-base leading-8 text-stone-600 sm:text-lg dark:text-[var(--studio-text)]">
              用 fps.de5.net 的 NewAPI 账号登录即可生成图片。支持文生图、图生图、多张并行、比例预设与历史续改；注册和充值统一跳转到 NewAPI 完成。
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-13 rounded-2xl bg-stone-950 px-6 text-white hover:bg-stone-800">
                <Link to="/login">
                  进入工作台
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-13 rounded-2xl border-stone-300 bg-white/70 px-6">
                <a href={registerURL} target="_blank" rel="noreferrer">
                  注册 NewAPI 账号
                </a>
              </Button>
              <Button asChild variant="outline" className="h-13 rounded-2xl border-stone-300 bg-white/70 px-6">
                <a href={rechargeURL} target="_blank" rel="noreferrer">
                  充值余额
                </a>
              </Button>
            </div>

            <div className="mt-8 grid max-w-[640px] gap-3 sm:grid-cols-3">
              {steps.map(([title, description], index) => (
                <div key={title} className="rounded-3xl border border-stone-200 bg-white/70 p-4 shadow-sm dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]">
                  <div className="flex size-8 items-center justify-center rounded-2xl bg-stone-950 text-sm font-semibold text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
                    {index + 1}
                  </div>
                  <div className="mt-3 text-sm font-semibold">{title}</div>
                  <div className="mt-2 text-xs leading-6 text-stone-500 dark:text-[var(--studio-text-muted)]">{description}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative min-h-[520px] rounded-[38px] border border-stone-200 bg-white/75 p-4 shadow-[0_32px_90px_rgba(68,58,40,0.16)] backdrop-blur dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel)]">
            <div className="grid h-full gap-4 rounded-[30px] bg-[#151515] p-4 text-white">
              <div className="grid gap-4 sm:grid-cols-[1fr_0.8fr]">
                <div className="overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_30%_20%,#fff7cc_0,#f2b56b_30%,#4c3a2f_62%,#111_100%)] p-5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-black/25 px-3 py-2 text-xs text-white/80 backdrop-blur">
                    <ImagePlus className="size-3.5" />
                    文生图
                  </div>
                  <div className="mt-32 max-w-[260px] text-2xl font-semibold leading-tight">
                    黄昏中的玻璃温室，电影感光线，细节丰富
                  </div>
                </div>
                <div className="grid gap-4">
                  <div className="rounded-[28px] bg-[#f2efe7] p-4 text-stone-950">
                    <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
                      <Brush className="size-4" />
                      局部编辑
                    </div>
                    <div className="mt-5 h-28 rounded-[22px] bg-[linear-gradient(135deg,#d7e6d1,#7b8f77_45%,#283323)]" />
                  </div>
                  <div className="rounded-[28px] border border-white/10 bg-white/10 p-4">
                    <div className="text-xs text-white/55">本次计费</div>
                    <div className="mt-2 flex items-end gap-2">
                      <span className="text-3xl font-semibold">$0.10</span>
                      <span className="pb-1 text-xs text-white/50">/ 成功出图</span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/10">
                      <div className="h-full w-2/3 rounded-full bg-[#d7f0c3]" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {["3:4", "16:9", "21:9"].map((ratio, index) => (
                  <div key={ratio} className="rounded-[26px] border border-white/10 bg-white/10 p-4">
                    <div className="text-xs text-white/45">比例预设</div>
                    <div className="mt-3 text-2xl font-semibold">{ratio}</div>
                    <div className="mt-4 h-16 rounded-2xl bg-white/10">
                      <div
                        className="h-full rounded-2xl bg-white/30"
                        style={{ width: `${58 + index * 12}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-[1180px] gap-4 px-5 pb-12 sm:px-8 lg:grid-cols-4 lg:px-10">
          {featureCards.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-[30px] border border-stone-200 bg-white/76 p-5 shadow-sm dark:border-[var(--studio-border)] dark:bg-[var(--studio-panel-soft)]">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-[var(--studio-accent-strong)] dark:text-[var(--studio-accent-foreground)]">
                  <Icon className="size-5" />
                </span>
                <h2 className="mt-5 text-lg font-semibold tracking-tight">{feature.title}</h2>
                <p className="mt-3 text-sm leading-7 text-stone-500 dark:text-[var(--studio-text)]">{feature.description}</p>
              </div>
            );
          })}
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-5 pb-10 sm:px-8 lg:px-10">
          <div className="grid gap-4 rounded-[34px] border border-stone-200 bg-stone-950 p-5 text-white shadow-[0_28px_80px_rgba(20,20,20,0.18)] sm:grid-cols-[1fr_auto] sm:items-center sm:p-7 dark:border-[var(--studio-border)]">
            <div>
              <div className="flex items-center gap-2 text-sm text-white/65">
                <WalletCards className="size-4" />
                余额与账号由 NewAPI 管理
              </div>
              <p className="mt-3 max-w-[720px] text-sm leading-7 text-white/72">
                没有账号时先注册；余额不足时去 NewAPI 充值。Image Studio 只负责生图工作流，不保存你的 NewAPI 支付信息。
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="rounded-2xl bg-white px-5 text-stone-950 hover:bg-stone-100">
                <a href={registerURL} target="_blank" rel="noreferrer">
                  注册
                </a>
              </Button>
              <Button asChild variant="outline" className="rounded-2xl border-white/20 bg-white/10 px-5 text-white hover:bg-white/15">
                <a href={rechargeURL} target="_blank" rel="noreferrer">
                  去充值
                </a>
              </Button>
              <Button asChild variant="outline" className="rounded-2xl border-white/20 bg-transparent px-5 text-white hover:bg-white/10">
                <Link to="/login">
                  已有账号登录
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
