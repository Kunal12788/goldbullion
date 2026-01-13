
import React, { useState } from 'react';
import { InventoryBatch } from '../types';
import { formatCurrency, formatGrams } from '../utils';
import { Archive, Layers, PackageCheck, PackageOpen, Calculator, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';

interface InventoryTableProps {
  batches: InventoryBatch[];
}

const InventoryTable: React.FC<InventoryTableProps> = ({ batches }) => {
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [marketRate, setMarketRate] = useState<string>('');

  const activeBatches = batches.filter(b => b.remainingQuantity > 0);
  const historyBatches = batches.filter(b => b.remainingQuantity === 0);
  const displayedHistoryBatches = [...historyBatches].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalStock = activeBatches.reduce((acc, b) => acc + b.remainingQuantity, 0);
  const totalValue = activeBatches.reduce((acc, b) => acc + (b.remainingQuantity * b.costPerGram), 0);
  const avgCost = totalStock > 0 ? totalValue / totalStock : 0;
  
  const totalHistoryStock = historyBatches.reduce((acc, b) => acc + b.originalQuantity, 0);
  const totalHistoryValue = historyBatches.reduce((acc, b) => acc + (b.originalQuantity * b.costPerGram), 0);
  const avgHistoryCost = totalHistoryStock > 0 ? totalHistoryValue / totalHistoryStock : 0;

  const rate = parseFloat(marketRate);
  const hasRate = !isNaN(rate) && rate > 0;
  const estimatedSalesValue = hasRate ? totalStock * rate : 0;
  const potentialProfit = hasRate ? estimatedSalesValue - totalValue : 0;
  const roiPercentage = (hasRate && totalValue > 0) ? (potentialProfit / totalValue) * 100 : 0;

  const StatBox = ({ label, value, sub, active = false }: any) => (
      <div className={`p-5 rounded-2xl border transition-all duration-300 ${active ? 'bg-slate-900 text-white border-slate-800 shadow-xl' : 'bg-white text-slate-900 border-slate-100 shadow-sm hover:shadow-md'}`}>
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${active ? 'text-gold-500' : 'text-slate-400'}`}>{label}</p>
          <p className="text-2xl font-mono font-bold tracking-tight">{value}</p>
          {sub && <p className={`text-[10px] mt-1.5 ${active ? 'text-slate-400' : 'text-slate-500'}`}>{sub}</p>}
      </div>
  );

  return (
    <div className="space-y-6 animate-slide-up">
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatBox label={viewMode === 'ACTIVE' ? "Total Live Stock" : "Total Volume Sold"} value={viewMode === 'ACTIVE' ? formatGrams(totalStock) : formatGrams(totalHistoryStock)} sub={viewMode === 'HISTORY' ? 'Lifetime volume processed' : 'Available for sale'} active />
            <StatBox label={viewMode === 'ACTIVE' ? "FIFO Valuation" : "Historical Cost Basis"} value={viewMode === 'ACTIVE' ? formatCurrency(totalValue) : formatCurrency(totalHistoryValue)} sub="Asset Value" />
            <StatBox label="Avg. Cost / Gram" value={viewMode === 'ACTIVE' ? formatCurrency(avgCost) : formatCurrency(avgHistoryCost)} sub="Weighted Average" />
       </div>

      {viewMode === 'ACTIVE' && (
        <div className="bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-800">
             <div className="bg-slate-900 p-6 flex flex-col lg:flex-row items-center gap-8 relative">
                 <div className="absolute top-0 right-0 w-96 h-96 bg-gold-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                 <div className="flex-1 w-full z-10">
                     <div className="flex items-center gap-3 mb-2 text-white font-bold text-lg">
                        <div className="p-2 bg-slate-800 rounded-lg text-gold-500"><Calculator className="w-5 h-5" /></div>
                        <span>Valuation Simulator</span>
                     </div>
                     <p className="text-slate-400 text-xs font-medium mb-4 ml-1">Enter current market rate to estimate liquidation value.</p>
                     <div className="relative max-w-xs">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-serif">₹</span>
                        <input type="number" value={marketRate} onChange={(e) => setMarketRate(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-4 py-3 text-white placeholder:text-slate-700 focus:border-gold-500 focus:ring-1 focus:ring-gold-500 outline-none font-mono text-lg transition-all" />
                     </div>
                 </div>
                 {hasRate && (
                      <div className="flex-[2] w-full grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-800/50 rounded-xl overflow-hidden border border-slate-700">
                          {[
                              { l: 'Est. Revenue', v: formatCurrency(estimatedSalesValue), c: 'text-white' },
                              { l: 'Unrealized P/L', v: formatCurrency(potentialProfit), c: potentialProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                              { l: 'Proj. ROI', v: `${roiPercentage.toFixed(2)}%`, c: roiPercentage >= 0 ? 'text-emerald-400' : 'text-red-400' }
                          ].map((i, idx) => (
                              <div key={idx} className="bg-slate-900 p-4 hover:bg-slate-800/80 transition-colors">
                                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">{i.l}</p>
                                  <p className={`text-xl font-mono font-bold ${i.c}`}>{i.v}</p>
                              </div>
                          ))}
                      </div>
                 )}
             </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-100 flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-10">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-3">
                {viewMode === 'ACTIVE' ? <div className="p-1.5 bg-green-50 text-green-600 rounded-lg"><PackageOpen className="w-5 h-5"/></div> : <div className="p-1.5 bg-slate-100 text-slate-500 rounded-lg"><PackageCheck className="w-5 h-5"/></div>}
                <span className="hidden sm:inline">{viewMode === 'ACTIVE' ? 'Inventory Batches' : 'Sold History'}</span>
                <span className="sm:hidden">{viewMode === 'ACTIVE' ? 'Live' : 'Sold'}</span>
            </h3>
            <div className="flex bg-slate-100/80 p-1 rounded-xl">
                {['ACTIVE', 'HISTORY'].map((m) => (
                    <button key={m} onClick={() => setViewMode(m as any)} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${viewMode === m ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-900'}`}>{m}</button>
                ))}
            </div>
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-sm border-separate border-spacing-y-2 px-4 pb-4 min-w-[800px]">
            <thead>
              <tr className="text-slate-400">
                {['Batch Date', 'Original Qty', 'Remaining', 'Cost / Gram', 'Total Value', 'Status'].map(h => <th key={h} className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {viewMode === 'ACTIVE' && activeBatches.map((batch) => (
                    <tr key={batch.id} className="group hover:translate-x-1 transition-transform duration-200">
                        <td className="px-4 py-3 bg-white border-y border-l border-slate-100 rounded-l-xl font-mono text-slate-600 text-xs shadow-sm">{batch.date}</td>
                        <td className="px-4 py-3 bg-white border-y border-slate-100 text-slate-500 font-medium shadow-sm">{formatGrams(batch.originalQuantity)}</td>
                        <td className="px-4 py-3 bg-white border-y border-slate-100 font-bold text-slate-900 shadow-sm">{formatGrams(batch.remainingQuantity)}</td>
                        <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono text-slate-500 text-xs shadow-sm">{formatCurrency(batch.costPerGram)}</td>
                        <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono font-bold text-slate-800 shadow-sm">{formatCurrency(batch.remainingQuantity * batch.costPerGram)}</td>
                        <td className="px-4 py-3 bg-white border-y border-r border-slate-100 rounded-r-xl shadow-sm text-center">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded-md border border-emerald-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Active
                            </span>
                        </td>
                    </tr>
                ))}
                {viewMode === 'HISTORY' && displayedHistoryBatches.map((batch) => (
                    <tr key={batch.id} className="group opacity-70 hover:opacity-100 transition-opacity">
                         <td className="px-4 py-3 bg-slate-50 border-y border-l border-slate-100 rounded-l-xl font-mono text-slate-500 text-xs">{batch.date}</td>
                         <td className="px-4 py-3 bg-slate-50 border-y border-slate-100 text-slate-500">{formatGrams(batch.originalQuantity)}</td>
                         <td className="px-4 py-3 bg-slate-50 border-y border-slate-100 font-bold text-slate-300">0.000 g</td>
                         <td className="px-4 py-3 bg-slate-50 border-y border-slate-100 font-mono text-slate-400 text-xs">{formatCurrency(batch.costPerGram)}</td>
                         <td className="px-4 py-3 bg-slate-50 border-y border-slate-100 font-mono text-slate-400">{formatCurrency(batch.originalQuantity * batch.costPerGram)}</td>
                         <td className="px-4 py-3 bg-slate-50 border-y border-r border-slate-100 rounded-r-xl text-center">
                             <span className="px-2.5 py-1 bg-slate-200 text-slate-500 text-[10px] font-bold uppercase rounded-md">Sold Out</span>
                         </td>
                    </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
export default InventoryTable;
