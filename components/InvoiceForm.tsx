
import React, { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Invoice, TransactionType } from '../types';
import { generateId, parseInvoiceOCR } from '../utils';
import { CheckCircle, AlertTriangle, ScanLine, Calculator, RefreshCw, ArrowRightLeft, Lock, Loader2, Sparkles, X } from 'lucide-react';
import { SingleDatePicker } from './SingleDatePicker';

interface InvoiceFormProps {
  onAdd: (invoice: Invoice) => void;
  currentStock: number;
  lockDate: string | null;
}

const InvoiceForm: React.FC<InvoiceFormProps> = ({ onAdd, currentStock, lockDate }) => {
  const [mode, setMode] = useState<'MANUAL' | 'UPLOAD'>('MANUAL');
  const [ocrText, setOcrText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'PURCHASE' as TransactionType,
    partyName: '',
    quantityGrams: '',
    ratePerGram: '',
    gstRate: '3',
  });

  const [error, setError] = useState('');

  const getTaxableTotal = () => {
      const qty = parseFloat(formData.quantityGrams);
      const rate = parseFloat(formData.ratePerGram);
      if (!isNaN(qty) && !isNaN(rate)) return (qty * rate).toFixed(2);
      return '';
  };

  const handleTotalChange = (value: string) => {
      const total = parseFloat(value);
      const qty = parseFloat(formData.quantityGrams);
      if (!isNaN(total) && !isNaN(qty) && qty > 0) {
          setFormData(prev => ({...prev, ratePerGram: (total / qty).toString()}));
      } else if (value === '') {
           setFormData(prev => ({...prev, ratePerGram: ''}));
      }
  };

  const handleOcrProcess = async () => {
      if (!ocrText.trim()) return;
      setIsProcessing(true);
      setError('');
      try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Extract invoice details. Purchase or Sale? Party Name? Date? Total Grams? Rate? GST Rate? Text: ${ocrText}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        date: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ["PURCHASE", "SALE"] },
                        partyName: { type: Type.STRING },
                        quantityGrams: { type: Type.NUMBER },
                        ratePerGram: { type: Type.NUMBER },
                        gstRate: { type: Type.NUMBER }
                    },
                    required: ["date", "type", "partyName", "quantityGrams", "ratePerGram"]
                }
            }
          });
          const data = JSON.parse(response.text || "{}");
          if (data && data.partyName) {
               setFormData({
                  date: data.date || new Date().toISOString().split('T')[0],
                  type: (data.type as TransactionType) || 'PURCHASE',
                  partyName: data.partyName || '',
                  quantityGrams: data.quantityGrams?.toString() || '',
                  ratePerGram: data.ratePerGram?.toString() || '',
                  gstRate: data.gstRate?.toString() || '3',
              });
              setMode('MANUAL');
              return;
          }
          throw new Error("Empty data");
      } catch (err) {
          const result = parseInvoiceOCR(ocrText);
          if (result) {
              setFormData({
                  ...formData,
                  date: result.date || formData.date,
                  partyName: result.partyName || formData.partyName,
                  quantityGrams: result.quantity > 0 ? result.quantity.toString() : '',
                  ratePerGram: result.rate > 0 ? result.rate.toString() : '',
                  gstRate: result.gstRate ? result.gstRate.toString() : formData.gstRate,
                  type: result.isSale ? 'SALE' : 'PURCHASE'
              });
              setMode('MANUAL'); 
          } else {
              setError('Could not extract data automatically. Please enter manually.');
          }
      } finally { setIsProcessing(false); }
  };

  const calculateTotals = () => {
    const qty = parseFloat(formData.quantityGrams) || 0;
    const rate = parseFloat(formData.ratePerGram) || 0;
    const gst = parseFloat(formData.gstRate) || 0;
    const taxable = qty * rate;
    const gstAmt = taxable * (gst / 100);
    return { taxable, gstAmt, total: taxable + gstAmt };
  };

  const { taxable, gstAmt, total } = calculateTotals();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (lockDate && formData.date <= lockDate) { setError(`Date Locked! Cannot add before ${lockDate}.`); return; }
    if (!formData.partyName || !formData.quantityGrams || !formData.ratePerGram) { setError('Fill all required fields.'); return; }
    const qty = parseFloat(formData.quantityGrams);
    if (formData.type === 'SALE' && qty > currentStock) { setError(`Insufficient Inventory! Avail: ${currentStock.toFixed(3)}g`); return; }

    onAdd({
        id: generateId(), date: formData.date, type: formData.type, partyName: formData.partyName,
        quantityGrams: qty, ratePerGram: parseFloat(formData.ratePerGram), gstRate: parseFloat(formData.gstRate),
        gstAmount: gstAmt, taxableAmount: taxable, totalAmount: total
    });
    setFormData({ date: new Date().toISOString().split('T')[0], type: 'PURCHASE', partyName: '', quantityGrams: '', ratePerGram: '', gstRate: '3' });
    setOcrText('');
  };

  const inputClass = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300";
  const labelClass = "block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider";

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-100 overflow-hidden flex flex-col animate-slide-up sticky top-0">
        {/* Header Toggle */}
        <div className="px-5 py-4 border-b border-slate-50 flex justify-between items-center bg-white">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-gold-100 to-gold-50 text-gold-700 rounded-lg"><Calculator className="w-4 h-4"/></div>
                <span className="hidden sm:inline">Transaction Entry</span>
                <span className="sm:hidden">Entry</span>
            </h2>
            <div className="flex bg-slate-100 p-1 rounded-xl scale-90 origin-right">
                {['MANUAL', 'UPLOAD'].map(m => (
                    <button key={m} onClick={() => setMode(m as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{m === 'MANUAL' ? 'Manual' : 'AI Scan'}</button>
                ))}
            </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
            {error && <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs rounded-xl flex items-center gap-2 animate-fade-in"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}</div>}
            
            {mode === 'UPLOAD' ? (
                <div className="space-y-4 animate-fade-in">
                    <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center hover:bg-slate-50 hover:border-gold-400 transition-all cursor-text relative group overflow-hidden min-h-[250px]">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3 text-slate-400 group-hover:scale-110 transition-transform"><ScanLine className="w-6 h-6" /></div>
                        <p className="font-medium text-slate-900 text-center text-sm">Paste Invoice Text</p>
                        <textarea className="absolute inset-0 opacity-0 cursor-text p-6 text-sm font-mono bg-transparent z-10" value={ocrText} onChange={(e) => setOcrText(e.target.value)} />
                        {ocrText && <div className="absolute inset-0 p-6 bg-slate-50 text-xs font-mono overflow-auto opacity-50 pointer-events-none whitespace-pre-wrap">{ocrText}</div>}
                    </div>
                    <button onClick={handleOcrProcess} disabled={!ocrText || isProcessing} className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 text-sm">
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin text-gold-400"/> : <Sparkles className="w-4 h-4 text-gold-400"/>} Process Invoice
                    </button>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
                    <div className="flex gap-4">
                        <div className="flex-1">
                             <label className={labelClass}>Type</label>
                             <div className="flex bg-slate-100 rounded-xl p-1">
                                 <button type="button" onClick={() => setFormData({...formData, type: 'PURCHASE'})} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${formData.type === 'PURCHASE' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>BUY</button>
                                 <button type="button" onClick={() => setFormData({...formData, type: 'SALE'})} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${formData.type === 'SALE' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>SELL</button>
                             </div>
                        </div>
                        <div className="flex-[1.5]">
                            <label className={labelClass}>Date</label>
                            <SingleDatePicker 
                                value={formData.date} 
                                onChange={(d) => setFormData({...formData, date: d})} 
                                className={inputClass} 
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>{formData.type === 'PURCHASE' ? 'Supplier Name' : 'Customer Name'}</label>
                        <input type="text" placeholder="Enter Name..." value={formData.partyName} onChange={(e) => setFormData({...formData, partyName: e.target.value})} className={inputClass} />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-1">
                             <label className={labelClass}>Grams</label>
                             <input type="number" step="0.001" placeholder="0.000" value={formData.quantityGrams} onChange={(e) => setFormData({...formData, quantityGrams: e.target.value})} className={`${inputClass} font-mono px-2`} />
                        </div>
                        <div className="col-span-1">
                             <label className={labelClass}>Rate</label>
                             <input type="number" step="0.01" placeholder="0.00" value={formData.ratePerGram} onChange={(e) => setFormData({...formData, ratePerGram: e.target.value})} className={`${inputClass} font-mono px-2`} />
                        </div>
                        <div className="col-span-1">
                             <label className={labelClass}>GST %</label>
                             <input type="number" step="0.1" value={formData.gstRate} onChange={(e) => setFormData({...formData, gstRate: e.target.value})} className={`${inputClass} font-mono px-2`} />
                        </div>
                    </div>
                    
                    <div className="pt-2">
                        <label className={labelClass}>Taxable Total (Auto-Calc Rate)</label>
                        <input type="number" value={getTaxableTotal()} onChange={(e) => handleTotalChange(e.target.value)} disabled={!parseFloat(formData.quantityGrams)} className={`${inputClass} font-mono ${!parseFloat(formData.quantityGrams) ? 'bg-slate-100' : 'bg-gold-50/30 border-gold-200 text-gold-900'}`} />
                    </div>

                    <div className="mt-4 bg-slate-900 rounded-xl p-5 text-white relative overflow-hidden shadow-lg">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/20 rounded-full blur-3xl -mr-10 -mt-10"></div>
                        <div className="relative z-10 space-y-1">
                            <div className="flex justify-between text-xs text-slate-400"><span>Taxable</span><span className="font-mono text-slate-200">{taxable.toLocaleString('en-IN', {style: 'currency', currency: 'INR'})}</span></div>
                            <div className="flex justify-between text-xs text-slate-400"><span>GST</span><span className="font-mono text-slate-200">{gstAmt.toLocaleString('en-IN', {style: 'currency', currency: 'INR'})}</span></div>
                            <div className="my-2 border-t border-slate-700"></div>
                            <div className="flex justify-between items-center"><span className="font-bold text-gold-400 uppercase tracking-widest text-[10px]">Net Payable</span><span className="font-mono text-xl font-bold">{total.toLocaleString('en-IN', {style: 'currency', currency: 'INR'})}</span></div>
                        </div>
                    </div>
                    <button type="submit" className="w-full bg-gradient-to-r from-gold-500 to-gold-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-gold-500/20 hover:shadow-gold-500/30 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 text-sm"><CheckCircle className="w-4 h-4" /> Confirm Transaction</button>
                </form>
            )}
        </div>
    </div>
  );
};
export default InvoiceForm;
