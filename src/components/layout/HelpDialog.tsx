import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            使用帮助
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold mb-2">如何使用SPSSAU？</h4>
            <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">上传数据：</strong>点击"数据上传"，选择Excel或CSV文件</li>
              <li><strong className="text-foreground">选择方法：</strong>在"数据分析"页面选择合适的分析方法</li>
              <li><strong className="text-foreground">添加变量：</strong>选择变量后点击"添加已选"按钮</li>
              <li><strong className="text-foreground">开始分析：</strong>点击"开始分析"按钮获得结果</li>
              <li><strong className="text-foreground">查看结果：</strong>在"分析结果"页面查看详细报告</li>
            </ol>
          </div>
          <Separator />
          <div>
            <h4 className="font-semibold mb-2">支持的分析方法</h4>
            <ul className="grid grid-cols-2 gap-1 text-muted-foreground">
              <li>· 描述性统计 / 频数分析</li>
              <li>· 相关分析 / 偏相关分析</li>
              <li>· T检验（独立/配对）</li>
              <li>· 方差分析 / 卡方检验</li>
              <li>· 线性回归 / 二元Logit回归</li>
              <li>· 信度分析 / 效度分析 / EFA / CFA</li>
              <li>· 中介作用 / 调节作用</li>
              <li>· 路径分析 / SEM</li>
              <li>· 聚类分析 / IPA分析</li>
            </ul>
          </div>
          <Separator />
          <div>
            <h4 className="font-semibold mb-2">导出功能</h4>
            <p className="text-muted-foreground">
              支持将分析结果导出为CSV表格或Word文档。在"分析结果"页面，您可以导出当前查看的结果；在左侧"报告项目"列表中，您可以勾选多个项目进行批量导出。
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
