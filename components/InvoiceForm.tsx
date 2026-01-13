import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GoogleGenAI, Type } from "@google/genai";
import { Invoice, TransactionType } from '../types';
import { generateId, parseInvoiceOCR } from '../utils';
import { CheckCircle, AlertTriangle, ScanLine, Calculator, RefreshCw, ArrowRightLeft, Lock, Loader2, Sparkles, X, Unlock, ShieldAlert, Calendar, User, Scale, DollarSign, Percent, Coins } from 'lucide-react';
import { SingleDatePicker } from './SingleDatePicker';

interface InvoiceFormProps {
  onAdd: (invoice: Invoice) => void;
  currentStock: number;
  lockDate: string | null;
  invoices: Invoice[]; 
  isWorkingMode: boolean; // Received from Parent (App)
  setIsWorkingMode: (v: boolean) => void; // Received from Parent
}

const InvoiceForm: React.FC<InvoiceFormProps> = ({ onAdd, currentStock, lockDate, invoices, isWorkingMode, setIsWorkingMode }) => {
  // Working Mode State is now managed by Parent (App.tsx)
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

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

  // Extract unique names from history based on selected transaction type
  const nameSuggestions = useMemo(() => {
      const filtered = invoices.filter(inv => inv.type === formData.type);
      const names = new Set(filtered.map(inv => inv.partyName));
      return Array.from(names).sort();
  }, [invoices, formData.type]);

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
    if (!isWorkingMode) return; // Double check

    setError('');
    if (lockDate && formData.date <= lockDate) { setError(`Date Locked! Cannot add before ${lockDate}.`); return; }
    if (!formData.partyName || !formData.quantityGrams || !formData.ratePerGram) { setError('Fill all required fields.'); return; }
    const qty = parseFloat(formData.quantityGrams);
    if (formData.type === 'SALE' && qty > currentStock) { setError(`Insufficient Inventory! Avail: ${currentStock.toFixed(3)}g`); return; }

    onAdd({
        id: generateId(), 
        date: formData.date, 
        type: formData.type, 
        partyName: formData.partyName,
        quantityGrams: qty, 
        ratePerGram: parseFloat(formData.ratePerGram), 
        gstRate: parseFloat(formData.gstRate),
        gstAmount: gstAmt, 
        taxableAmount: taxable, 
        totalAmount: total,
        createdAt: new Date().toISOString() // STRICT ORDERING: Capture timestamp
    });
    setFormData({ date: new Date().toISOString().split('T')[0], type: 'PURCHASE', partyName: '', quantityGrams: '', ratePerGram: '', gstRate: '3' });
    setOcrText('');
  };

  const handleUnlock = (e: React.FormEvent) => {
      e.preventDefault();
      if (authPassword === 'QAZ@123') {
          setIsWorkingMode(true);
          setShowAuthModal(false);
          setAuthPassword('');
          setAuthError('');
      } else {
          setAuthError('Invalid Working Mode password.');
      }
  };

  const inputGroupClass = "relative flex items-center";
  const iconClass = "absolute left-3.5 text-slate-400 w-4 h-4 pointer-events-none";
  const inputClass = "w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 disabled:bg-slate-50 disabled:text-slate-400";
  const labelClass = "block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1";

  return (
    <>
    {/* Password Modal */}
    {showAuthModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-slate-200 animate-slide-up relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900"></div>
                <button 
                    onClick={() => { setShowAuthModal(false); setAuthPassword(''); setAuthError(''); }} 
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col items-center text-center gap-3 mb-6 mt-2">
                    <div className="w-14 h-14 rounded-full bg-slate-50 text-slate-800 flex items-center justify-center shadow-inner border border-slate-100">
                        <Lock className="w-6 h-6"/>
                    </div>
                    <div>
                         <h3 className="text-lg font-bold text-slate-900">Authenticate Access</h3>
                         <p className="text-xs text-slate-500 mt-1">Working Mode requires authorization.</p>
                    </div>
                </div>
                
                <form onSubmit={handleUnlock}>
                    <div className="mb-4">
                        <input 
                            type="password" 
                            placeholder="Enter Security Code" 
                            value={authPassword}
                            onChange={(e) => setAuthPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-center focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 outline-none transition-all tracking-widest placeholder:tracking-normal"
                            autoFocus
                        />
                        {authError && <p className="text-xs text-red-500 mt-2 text-center font-bold flex items-center justify-center gap-1"><AlertTriangle className="w-3 h-3"/> {authError}</p>}
                    </div>
                    <button type="submit" className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 text-sm flex items-center justify-center gap-2 hover:translate-y-[-1px]">
                        <Unlock className="w-4 h-4"/> Enable Write Access
                    </button>
                </form>
            </div>
        </div>,
        document.body
    )}

    <div className={`bg-white rounded-2xl shadow-card border border-slate-100 overflow-hidden flex flex-col animate-slide-up sticky top-6 transition-all duration-300 ${!isWorkingMode ? 'border-slate-200' : 'ring-1 ring-black/5'}`}>
        {/* Header Toggle */}
        <div className={`px-5 py-4 border-b flex justify-between items-center transition-colors ${isWorkingMode ? 'bg-white border-slate-100' : 'bg-slate-50 border-slate-200'}`}>
            <h2 className="font-bold text-slate-900 flex items-center gap-3">
                {isWorkingMode ? (
                    <div className="p-2 bg-green-50 text-green-600 rounded-lg border border-green-100"><CheckCircle className="w-4 h-4"/></div>
                ) : (
                    <div className="p-2 bg-slate-200 text-slate-500 rounded-lg"><Lock className="w-4 h-4"/></div>
                )}
                <div className="flex flex-col">
                    <span className="text-sm font-bold leading-tight">New Transaction</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isWorkingMode ? 'text-green-600' : 'text-slate-400'}`}>
                        {isWorkingMode ? 'Writing Enabled' : 'Read Only Mode'}
                    </span>
                </div>
            </h2>
            
            {isWorkingMode ? (
                <button 
                    onClick={() => setIsWorkingMode(false)} 
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[10px] font-bold hover:bg-slate-50 transition-all flex items-center gap-1.5 uppercase tracking-wide"
                >
                    <Lock className="w-3 h-3"/> Lock
                </button>
            ) : (
                <button 
                    onClick={() => setShowAuthModal(true)} 
                    className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold hover:bg-slate-800 transition-all shadow-md flex items-center gap-1.5 uppercase tracking-wide"
                >
                    <Unlock className="w-3 h-3"/> Unlock
                </button>
            )}
        </div>

        <div className="p-6 flex flex-col gap-5 relative">
            {/* Disabled Overlay */}
            {!isWorkingMode && (
                <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-6 cursor-not-allowed select-none transition-all duration-500">
                    <div className="bg-white p-4 rounded-2xl shadow-xl mb-3 border border-slate-100">
                        <ShieldAlert className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-slate-900 font-bold mb-1">Restricted Access</h3>
                    <p className="text-xs text-slate-500 max-w-[200px]">Unlock to manage inventory.</p>
                </div>
            )}

            <fieldset disabled={!isWorkingMode} className={`flex flex-col gap-5 transition-all duration-300 ${!isWorkingMode ? 'opacity-30' : 'opacity-100'}`}>
                {/* Mode Switcher inside the locked area */}
                <div className="flex justify-end">
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                        {['MANUAL', 'UPLOAD'].map(m => (
                            <button type="button" key={m} onClick={() => setMode(m as any)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{m === 'MANUAL' ? 'Manual Entry' : 'AI Parser'}</button>
                        ))}
                    </div>
                </div>

                {error && <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs rounded-xl flex items-center gap-2 animate-fade-in font-medium"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}</div>}
                
                {mode === 'UPLOAD' ? (
                    <div className="space-y-4 animate-fade-in">
                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center hover:bg-slate-50 hover:border-slate-300 transition-all cursor-text relative group overflow-hidden min-h-[280px]">
                            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-3 text-slate-400 group-hover:scale-110 transition-transform"><ScanLine className="w-7 h-7" /></div>
                            <p className="font-bold text-slate-900 text-sm">Paste Invoice Data</p>
                            <p className="text-xs text-slate-400 mt-1">AI will extract the details</p>
                            <textarea className="absolute inset-0 opacity-0 cursor-text p-6 text-sm font-mono bg-transparent z-10" value={ocrText} onChange={(e) => setOcrText(e.target.value)} disabled={!isWorkingMode} />
                            {ocrText && <div className="absolute inset-0 p-6 bg-slate-50 text-xs font-mono overflow-auto opacity-70 pointer-events-none whitespace-pre-wrap text-slate-700">{ocrText}</div>}
                        </div>
                        <button type="button" onClick={handleOcrProcess} disabled={!ocrText || isProcessing || !isWorkingMode} className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 text-sm transition-all hover:translate-y-[-1px]">
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin text-white"/> : <Sparkles className="w-4 h-4 text-gold-400"/>} 
                            <span>Process with AI</span>
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
                        <div className="flex gap-4">
                            <div className="flex-1">
                                 <label className={labelClass}>Transaction</label>
                                 <div className="flex bg-slate-100 rounded-xl p-1 h-[46px]">
                                     <button type="button" onClick={() => setFormData({...formData, type: 'PURCHASE'})} className={`flex-1 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${formData.type === 'PURCHASE' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><ArrowRightLeft className="w-3 h-3"/> BUY</button>
                                     <button type="button" onClick={() => setFormData({...formData, type: 'SALE'})} className={`flex-1 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${formData.type === 'SALE' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><Coins className="w-3 h-3"/> SELL</button>
                                 </div>
                            </div>
                            <div className="flex-[1.2]">
                                <label className={labelClass}>Date</label>
                                <div className={!isWorkingMode ? 'pointer-events-none' : ''}>
                                    <SingleDatePicker 
                                        value={formData.date} 
                                        onChange={(d) => setFormData({...formData, date: d})} 
                                        className={`${inputClass} text-left flex items-center`}
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className={labelClass}>{formData.type === 'PURCHASE' ? 'Supplier Name' : 'Customer Name'}</label>
                            <div className={inputGroupClass}>
                                <User className={iconClass}/>
                                <input 
                                    type="text" 
                                    list="party-names"
                                    placeholder="Select or Enter Name..." 
                                    value={formData.partyName} 
                                    onChange={(e) => setFormData({...formData, partyName: e.target.value})} 
                                    className={inputClass} 
                                />
                            </div>
                            <datalist id="party-names">
                                {nameSuggestions.map((name) => (
                                    <option key={name} value={name} />
                                ))}
                            </datalist>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-1">
                                 <label className={labelClass}>Weight (g)</label>
                                 <div className={inputGroupClass}>
                                    <Scale className={iconClass}/>
                                    <input type="number" step="0.001" placeholder="0.000" value={formData.quantityGrams} onChange={(e) => setFormData({...formData, quantityGrams: e.target.value})} className={`${inputClass} font-mono`} />
                                 </div>
                            </div>
                            <div className="col-span-1">
                                 <label className={labelClass}>Rate</label>
                                 <div className={inputGroupClass}>
                                    <DollarSign className={iconClass}/>
                                    <input type="number" step="0.01" placeholder="0.00" value={formData.ratePerGram} onChange={(e) => setFormData({...formData, ratePerGram: e.target.value})} className={`${inputClass} font-mono`} />
                                 </div>
                            </div>
                            <div className="col-span-1">
                                 <label className={labelClass}>GST %</label>
                                 <div className={inputGroupClass}>
                                    <Percent className={iconClass}/>
                                    <input type="number" step="0.1" value={formData.gstRate} onChange={(e) => setFormData({...formData, gstRate: e.target.value})} className={`${inputClass} font-mono`} />
                                 </div>
                            </div>
                        </div>
                        
                        <div className="pt-2">
                            <label className={labelClass}>Auto-Calculate Rate (Optional)</label>
                            <div className={inputGroupClass}>
                                <Calculator className={iconClass}/>
                                <input type="number" placeholder="Enter Total Taxable Value..." value={getTaxableTotal()} onChange={(e) => handleTotalChange(e.target.value)} disabled={!parseFloat(formData.quantityGrams) || !isWorkingMode} className={`${inputClass} font-mono ${!parseFloat(formData.quantityGrams) ? 'bg-slate-50' : 'bg-slate-50/50 border-slate-200 text-slate-800'}`} />
                            </div>
                        </div>

                        <div className="mt-2 bg-slate-900 rounded-xl p-5 text-white relative overflow-hidden shadow-lg border border-slate-800">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                            <div className="relative z-10 space-y-2">
                                <div className="flex justify-between text-xs font-medium text-slate-400"><span>Taxable Value</span><span className="font-mono text-slate-200">{taxable.toLocaleString('en-IN', {style: 'currency', currency: 'INR'})}</span></div>
                                <div className="flex justify-between text-xs font-medium text-slate-400"><span>GST Amount</span><span className="font-mono text-slate-200">{gstAmt.toLocaleString('en-IN', {style: 'currency', currency: 'INR'})}</span></div>
                                <div className="my-2 border-t border-slate-700"></div>
                                <div className="flex justify-between items-center"><span className="font-bold text-gold-400 uppercase tracking-widest text-[10px]">Net Payable</span><span className="font-mono text-xl font-bold text-white">{total.toLocaleString('en-IN', {style: 'currency', currency: 'INR'})}</span></div>
                            </div>
                        </div>
                        <button type="submit" disabled={!isWorkingMode} className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:cursor-not-allowed">
                            <CheckCircle className="w-4 h-4 text-green-400" /> Confirm Transaction
                        </button>
                    </form>
                )}
            </fieldset>
        </div>
    </div>
    </>
  );
};
export default InvoiceForm;