'use client';

// 「拠点種別構成」カード。登録拠点を種別ごとに数えてドーナツグラフと凡例で見せる。

import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import { getLocationTypeLabel, type LocationRecord } from '../types';

export const LocationTypeChart = ({ database }: { database: LocationRecord[] }) => {
  // Dynamic Pie Chart generation
  const pieData = useMemo(() => {
    const colors = [
      'var(--color-primary)',
      'var(--color-info)',
      'var(--color-chart-indigo)',
      'var(--color-scope-3)',
      'var(--color-warning)',
      'var(--color-chart-pink)',
      'var(--color-chart-rose)',
      'var(--color-chart-teal)',
      'var(--color-chart-gray)'
    ];
    const groups: Record<string, number> = {};
    database.forEach(item => {
      const typeLabel = getLocationTypeLabel(item.type);
      groups[typeLabel] = (groups[typeLabel] || 0) + 1;
    });

    return Object.keys(groups).map((key, index) => ({
      name: key,
      value: groups[key],
      color: colors[index % colors.length]
    }));
  }, [database]);

  return (
    <Card className="lg:col-span-2 flex flex-col gap-4">
       <h2 className="gt-card-title">拠点種別構成</h2>
       {database.length === 0 ? (
         <div className="flex items-center justify-center h-48 text-sm text-text-muted">
           拠点データがありません
         </div>
       ) : (
         <div className="flex items-center h-48">
           <div className="w-1/2 h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value">
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
           </div>
           <div className="flex flex-col gap-2 text-sm w-1/2 max-h-full overflow-y-auto">
              {pieData.map((item, i) => (
                <div key={i} className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-1 text-xs min-w-0">
                    <div style={{ backgroundColor: item.color }} className="w-2 h-2 rounded-full shrink-0"></div>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="flex gap-1 text-text-muted text-xs whitespace-nowrap">
                    <span className="font-bold text-text-main">{item.value}</span>
                    <span>({database.length ? ((item.value/database.length)*100).toFixed(0) : 0}%)</span>
                  </div>
                </div>
              ))}
           </div>
         </div>
       )}
    </Card>
  );
};
