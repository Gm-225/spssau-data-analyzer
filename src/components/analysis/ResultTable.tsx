import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ResultTable as ResultTableType } from "@/lib/analysis-engine"

function TableView({ table }: { table: ResultTableType }) {
  if (table.type === "text") {
    return (
      <div className="space-y-2 text-sm leading-7 text-foreground/85">
        {table.rows.map((row, index) => <p key={index}>{row.map(String).join(" ")}</p>)}
      </div>
    )
  }
  return (
    <div className="overflow-hidden border-y border-foreground/70">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/50 bg-muted/30">
              {table.headers.map((h, i) => (
                <th key={i} title={h} className="min-w-24 max-w-[260px] break-words px-3 py-2 text-center text-xs font-semibold leading-5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} title={String(cell)} className="max-w-[300px] break-words px-3 py-1.5 text-center text-xs leading-5">
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ResultTable({ table }: { table: ResultTableType }) {
  const isSection = table.type === "text" && /^\d+、/.test(table.title)
  return (
    <Card className={isSection ? "border-none bg-transparent shadow-none" : "shadow-sm"}>
      <CardHeader className="pb-3">
        <CardTitle className={isSection ? "text-lg font-bold" : "text-sm"}>{table.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <TableView table={table} />
      </CardContent>
    </Card>
  )
}
