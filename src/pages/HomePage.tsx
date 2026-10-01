import { store } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Upload, BarChart2, Database, PieChart, FileType, ChevronRight, Sparkles, TrendingUp, Shield, Zap } from "lucide-react"

const features = [
  { icon: BarChart2, title: "数据分析方法", desc: "描述统计、T检验、方差分析、回归分析、卡方检验等20+种方法" },
  { icon: Database, title: "数据处理功能", desc: "支持Excel/CSV数据导入，自动识别变量类型，智能缺失值处理" },
  { icon: PieChart, title: "可视化图表", desc: "自动生成专业统计图表，支持自定义样式与导出" },
  { icon: FileType, title: "规范化输出", desc: "一键生成真实 Word/PDF，含中文学术三线表与自动解读" },
]

const stats = [
  { value: "20+", label: "分析方法" },
  { value: "4", label: "导出格式" },
  { value: "100%", label: "离线运行" },
  { value: "免费", label: "永久免费" },
]

export function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 sm:py-28">
          <div className="flex flex-col items-center text-center gap-6">
            <Badge variant="secondary" className="rounded-full px-4 py-1.5 text-xs gap-2">
              <Sparkles className="h-3 w-3" />
              v2.0 · 全新界面
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              数据分析，
              <span className="text-primary">如此简单</span>
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              无需编程，拖拽操作，一键生成专业统计分析报告
            </p>
            <div className="flex items-center gap-3">
              <Button
                size="lg"
                className="h-12 px-8 text-base gap-2 rounded-full"
                onClick={() => store.setPage("upload")}
              >
                <Upload className="h-5 w-5" />
                开始分析
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-12 px-8 text-base gap-2 rounded-full"
                onClick={() => store.setPage("analysis")}
              >
                了解更多
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-1">
                <span className="text-2xl font-bold text-primary">{s.value}</span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">核心功能</h2>
          <p className="mt-2 text-muted-foreground">一站式数据统计分析解决方案</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <Card key={f.title} className="group transition-all hover:shadow-md hover:border-primary/20">
              <CardHeader className="pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <f.icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">{f.desc}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Analysis Methods */}
      <section className="bg-muted/30 border-y">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">支持的分析方法</h2>
            <p className="mt-2 text-muted-foreground">覆盖常用统计分析场景</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { cat: "描述统计", items: ["描述性统计", "频数分析"] },
              { cat: "相关与回归", items: ["相关分析", "偏相关分析", "线性回归", "二元Logit回归"] },
              { cat: "差异检验", items: ["T检验", "方差分析", "卡方检验"] },
              { cat: "信效度分析", items: ["信度分析", "效度分析", "EFA", "CFA"] },
              { cat: "结构方程", items: ["中介作用", "调节作用", "路径分析", "SEM"] },
              { cat: "其他方法", items: ["聚类分析", "IPA分析"] },
            ].map((group) => (
              <Card key={group.cat} className="bg-background">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{group.cat}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {group.items.map((item) => (
                      <li key={item} className="text-sm text-muted-foreground flex items-center gap-2">
                        <span className="h-1 w-1 rounded-full bg-primary/50" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>AI 数据分析器 v2.0 · 本地科学计算 · 数据不上传</p>
      </footer>
    </div>
  )
}
