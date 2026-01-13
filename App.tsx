
import React, { useState, useEffect, useMemo } from 'react';
import { Session } from '@supabase/supabase-js';
import Layout from './components/Layout';
import Auth from './components/Auth';
import InvoiceForm from './components/InvoiceForm';
import InventoryTable from './components/InventoryTable';
import StatsCard from './components/StatsCard';
import { DateRangePicker } from './components/DateRangePicker'; 
import Toast, { ToastMessage } from './components/Toast'; 
import { Invoice, InventoryBatch, CustomerStat, AgingStats, SupplierStat, RiskAlert } from './types';
import { loadInvoices, resetData } from './services/storeService'; // Kept ONLY for migration
import { supabase, saveOrderToSupabase, fetchOrders, deleteOrderFromSupabase, bulkInsertOrders, updateOrderPartyName } from './services/supabase';
import { formatCurrency, formatGrams, getDateDaysAgo, calculateStockAging, calculateSupplierStats, calculateTurnoverStats, generateId, downloadCSV } from './utils';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  ArrowUpRight, Scale, Coins, Trash2, TrendingUp, AlertTriangle, 
  FileSpreadsheet, FileText, Factory, Lock, ArrowRightLeft, LineChart as LineChartIcon, 
  Download, Users, ChevronRight, ChevronLeft, Crown, Briefcase, 
  Timer, Activity, Wallet, FileDown, CheckCircle, CloudCog, RefreshCw, CloudUpload, Server, Database, Info, Edit2, Eye, Loader2
} from 'lucide-react';
import { 
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Sector 
} from 'recharts';

// --- Shared UI Components ---

const Card: React.FC<{ children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode, delay?: number }> = ({ children, className = '', title, action, delay = 0 }) => (
  <div 
    className={`bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden animate-slide-up transition-all duration-300 hover:shadow-lg ${className}`}
    style={{ animationDelay: `${delay}ms` }}
  >
    {title && (
      <div className="px-6 py-5 border-b border-slate-50 flex flex-wrap justify-between items-center bg-white/80 backdrop-blur-sm sticky top-0 z-10 gap-4">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2 tracking-tight">{title}</h3>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className="p-6 flex-1 overflow-auto">{children}</div>
  </div>
);

const SectionHeader: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 animate-slide-up">
    <div>
      <h2 className="text-3xl font-bold text-slate-900 tracking-tight leading-tight">{title}</h2>
      {subtitle && <p className="text-slate-500 text-sm mt-1.5 font-medium">{subtitle}</p>}
    </div>
    {action && <div className="flex gap-2 w-full md:w-auto">{action}</div>}
  </div>
);

const ExportMenu: React.FC<{ onExport: (type: 'CSV' | 'PDF') => void }> = ({ onExport }) => (
    <div className="flex gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
        <button onClick={() => onExport('CSV')} className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors rounded-lg">
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
        </button>
        <div className="w-px bg-slate-100 my-1"></div>
        <button onClick={() => onExport('PDF')} className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors rounded-lg">
            <FileText className="w-3.5 h-3.5" /> PDF
        </button>
    </div>
);

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventory, setInventory] = useState<InventoryBatch[]>([]);
  const [marketRate, setMarketRate] = useState<string>(''); 
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbError, setDbError] = useState(false); // Track DB connection/schema errors
  
  // Theme State: Forced Light Mode
  const isDarkMode = false; 

  useEffect(() => {
      // Ensure any existing dark mode preference is cleared
      document.documentElement.classList.remove('dark');
      localStorage.removeItem('theme');
  }, []);

  const toggleTheme = () => {}; // No-op

  // Working Mode State (Lifted Up)
  const [isWorkingMode, setIsWorkingMode] = useState(false);

  // Delete Modal State
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Edit Name Modal State
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editNameId, setEditNameId] = useState<string | null>(null);
  const [editNamePassword, setEditNamePassword] = useState('');
  const [newPartyName, setNewPartyName] = useState('');

  // Export Password Protection State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [pendingExport, setPendingExport] = useState<{ type: 'CSV' | 'PDF', handler: (t: 'CSV' | 'PDF') => void } | null>(null);
  
  const [dateRange, setDateRange] = useState({
      start: getDateDaysAgo(30),
      end: new Date().toISOString().split('T')[0]
  });
  const [lockDate, setLockDate] = useState<string | null>(localStorage.getItem('bullion_lock_date') || null);

  // Authentication Check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Reset Working Mode on Session End
  useEffect(() => {
    if (!session) {
      setIsWorkingMode(false);
    }
  }, [session]);

  const addToast = (type: 'SUCCESS' | 'ERROR', message: string) => {
      const id = generateId();
      setToasts(prev => [...prev, { id, type, message }]);
  };
  const removeToast = (id: string) => {
      setToasts(prev => prev.filter(t => t.id !== id));
  };

  // --- Export Security Interceptor ---
  const initiateExport = (handler: (t: 'CSV' | 'PDF') => void, type: 'CSV' | 'PDF') => {
      setPendingExport({ handler, type });
      setExportPassword('');
      setShowExportModal(true);
  };

  const confirmExport = () => {
      if (exportPassword === 'QAZ@654') {
          if (pendingExport) {
              pendingExport.handler(pendingExport.type);
          }
          setShowExportModal(false);
          setPendingExport(null);
          setExportPassword('');
      } else {
          addToast('ERROR', 'Incorrect Export Password.');
      }
  };

  const renderDateFilter = () => (
      <div className="w-full sm:w-auto">
          <DateRangePicker 
              startDate={dateRange.start} 
              endDate={dateRange.end} 
              onChange={(start, end) => setDateRange({ start, end })} 
          />
      </div>
  );

  // --- CORE LOGIC: Recalculate State from Transactions ---
  const recalculateAllData = (allInvoices: Invoice[]) => {
    // FIX: Strict FIFO Engine with Timestamp Sequencing
    const sorted = [...allInvoices].sort((a, b) => {
        // 1. Primary: Business Date
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        
        // 2. Secondary: Transaction Timestamp (Strict Sequencing)
        if (a.createdAt && b.createdAt) {
            const timeComp = a.createdAt.localeCompare(b.createdAt);
            if (timeComp !== 0) return timeComp;
        }
        
        // 3. Fallback: ID (Deterministic tie-breaker)
        return a.id.localeCompare(b.id);
    });

    let currentInventory: InventoryBatch[] = [];
    const processedInvoices: Invoice[] = [];

    for (const inv of sorted) {
        if (inv.type === 'PURCHASE') {
            const newBatch: InventoryBatch = {
                id: inv.id,
                date: inv.date,
                originalQuantity: inv.quantityGrams,
                remainingQuantity: inv.quantityGrams,
                costPerGram: inv.ratePerGram
            };
            currentInventory.push(newBatch);
            // Purchase has no COGS/Profit/Log
            processedInvoices.push({ ...inv, cogs: 0, profit: 0, fifoLog: [] });
        } else {
            // SALE Logic - Strict Consumption
            let remainingToSell = inv.quantityGrams;
            let totalCOGS = 0;
            const consumptionLog: string[] = [];
            
            // Validation: Warn if sequencing might be ambiguous
            if (!inv.createdAt) {
                consumptionLog.push("⚠️ WARNING: No Timestamp. Sequence assumed by ID.");
            }

            for (const batch of currentInventory) {
                if (remainingToSell <= 0) break;
                
                // Skip empty batches (already closed)
                if (batch.remainingQuantity > 0.0001) { // Floating point tolerance
                    const take = Math.min(batch.remainingQuantity, remainingToSell);
                    
                    batch.remainingQuantity -= take;
                    remainingToSell -= take;
                    
                    const costForChunk = take * batch.costPerGram;
                    totalCOGS += costForChunk;
                    
                    // Audit Trail
                    consumptionLog.push(`${formatGrams(take)} from ${batch.date} @ ${formatCurrency(batch.costPerGram)}`);

                    if (batch.remainingQuantity < 0.0001) {
                         batch.remainingQuantity = 0;
                         batch.closedDate = inv.date;
                    }
                }
            }

            // If we ran out of stock but still needed to sell (Negative Inventory Scenario)
            if (remainingToSell > 0.0001) {
                consumptionLog.push(`⚠️ STOCKOUT: ${formatGrams(remainingToSell)} sold without inventory!`);
            }

            const profit = (inv.taxableAmount || (inv.quantityGrams * inv.ratePerGram)) - totalCOGS;
            processedInvoices.push({ ...inv, cogs: totalCOGS, profit, fifoLog: consumptionLog });
        }
    }
    
    return {
        updatedInvoices: processedInvoices,
        updatedInventory: currentInventory
    };
  };

  // --- DATA LOADING & SYNC ---
  const loadData = async () => {
        try {
            setIsSyncing(true);
            const cloudOrders = await fetchOrders();
            const localOrders = loadInvoices(); 
            
            if (cloudOrders === null) {
                setDbError(true);
                // Fallback to local data if cloud fails
                const { updatedInvoices, updatedInventory } = recalculateAllData(localOrders);
                setInvoices(updatedInvoices.reverse()); 
                setInventory(updatedInventory);
                return;
            }
            setDbError(false);

            // Check if local items are missing from cloud
            const cloudIds = new Set(cloudOrders.map(o => o.id));
            const unsyncedLocalOrders = localOrders.filter(lo => !cloudIds.has(lo.id));
            
            let finalOrders = cloudOrders;
            
            // If cloud is empty but we have local, use local temporarily for display until sync
            if (cloudOrders.length === 0 && localOrders.length > 0) {
                finalOrders = localOrders;
            } else if (unsyncedLocalOrders.length > 0) {
                 // Mixed state: show both so user doesn't panic, but user needs to sync
                 finalOrders = [...cloudOrders, ...unsyncedLocalOrders];
            }

            const { updatedInvoices, updatedInventory } = recalculateAllData(finalOrders);
            setInvoices(updatedInvoices.reverse()); 
            setInventory(updatedInventory);
        } catch (e) {
            console.error(e);
            addToast('ERROR', 'Failed to load data.');
        } finally {
            setIsSyncing(false);
        }
  };

  useEffect(() => {
    if (!session) return;
    loadData();
  }, [session]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
        const localOrders = loadInvoices();
        const cloudOrders = await fetchOrders();
        
        // If DB error, stop
        if (cloudOrders === null) {
            setDbError(true);
            addToast('ERROR', 'Database error. Please fix the SQL setup first.');
            return;
        }

        const cloudIds = new Set(cloudOrders.map(o => o.id));
        const missingInCloud = localOrders.filter(l => !cloudIds.has(l.id));

        if (missingInCloud.length === 0) {
            addToast('SUCCESS', 'Everything is up to date!');
        } else {
            const success = await bulkInsertOrders(missingInCloud);
            if (success) {
                addToast('SUCCESS', `Successfully uploaded ${missingInCloud.length} records.`);
                await loadData(); // Reload strictly from cloud
            } else {
                addToast('ERROR', 'Upload failed. Check connection.');
            }
        }
    } catch (e) {
        addToast('ERROR', 'Sync error occurred.');
    } finally {
        setIsSyncing(false);
    }
  };

  useEffect(() => {
      if(lockDate) localStorage.setItem('bullion_lock_date', lockDate);
      else localStorage.removeItem('bullion_lock_date');
  }, [lockDate]);

  const handleLogout = async () => {
      setIsWorkingMode(false);
      await supabase.auth.signOut();
  };

  // --- DERIVED INTELLIGENCE (GLOBAL) ---
  const filteredInvoices = useMemo(() => {
      const query = searchQuery.toLowerCase();
      return invoices.filter(inv => {
          const matchesDate = inv.date >= dateRange.start && inv.date <= dateRange.end;
          const matchesSearch = !query || inv.partyName.toLowerCase().includes(query);
          return matchesDate && matchesSearch;
      });
  }, [invoices, dateRange, searchQuery]);

  // Inventory filtered by Date AND Search (for Table View)
  const filteredInventory = useMemo(() => {
      const query = searchQuery.toLowerCase();
      return inventory.filter(batch => {
          const matchesDate = batch.date >= dateRange.start && batch.date <= dateRange.end;
          if (!matchesDate) return false;
          if (!query) return true;
          const invoice = invoices.find(inv => inv.id === batch.id);
          return invoice ? invoice.partyName.toLowerCase().includes(query) : false;
      });
  }, [inventory, invoices, dateRange, searchQuery]);

  // Inventory filtered ONLY by Search (for Global Stock Stats)
  const searchFilteredInventory = useMemo(() => {
      const query = searchQuery.toLowerCase();
      if (!query) return inventory;
      return inventory.filter(batch => {
          const invoice = invoices.find(inv => inv.id === batch.id);
          return invoice ? invoice.partyName.toLowerCase().includes(query) : false;
      });
  }, [inventory, invoices, searchQuery]);

  const currentStock = useMemo(() => searchFilteredInventory.reduce((acc, batch) => acc + batch.remainingQuantity, 0), [searchFilteredInventory]);
  const fifoValue = useMemo(() => searchFilteredInventory.reduce((acc, batch) => acc + (batch.remainingQuantity * batch.costPerGram), 0), [searchFilteredInventory]);

  const agingStats: AgingStats = useMemo(() => calculateStockAging(searchFilteredInventory), [searchFilteredInventory]);

  const { customerData, totalProfit, profitTrendData, dailyProfit } = useMemo(() => {
      const customerStats: Record<string, CustomerStat & { avgQtyPerTx?: number, avgSellingPrice?: number, behaviorPattern?: string }> = {};
      let totalRevenueExTax = 0;
      let totalProfitCalc = 0;

      filteredInvoices.forEach(inv => {
          if (!customerStats[inv.partyName]) {
              customerStats[inv.partyName] = { 
                  name: inv.partyName, totalGrams: 0, totalSpend: 0, profitContribution: 0, txCount: 0, avgProfitPerGram: 0
              };
          }
          customerStats[inv.partyName].txCount += 1;

          if (inv.type === 'SALE') {
              customerStats[inv.partyName].totalGrams += inv.quantityGrams;
              customerStats[inv.partyName].totalSpend += inv.taxableAmount; 
              customerStats[inv.partyName].profitContribution += (inv.profit || 0);

              totalRevenueExTax += (inv.quantityGrams * inv.ratePerGram);
              totalProfitCalc += (inv.profit || 0);
          }
      });

      const data = Object.values(customerStats)
        .filter(stat => stat.totalSpend > 0)
        .map(stat => {
            const margin = stat.totalSpend > 0 ? (stat.profitContribution / stat.totalSpend) * 100 : 0;
            const avgQty = stat.totalGrams / stat.txCount;
            const avgSell = stat.totalGrams > 0 ? stat.totalSpend / stat.totalGrams : 0;
            const avgProfit = stat.totalGrams > 0 ? stat.profitContribution / stat.totalGrams : 0;
            
            let pattern = "Regular";
            if(avgQty > 100) pattern = "Bulk Buyer";
            else if(stat.txCount > 5) pattern = "Frequent";
            
            if(margin < 0.5) pattern += " (Price Sensitive)";
            else if(margin > 2.0) pattern += " (High Margin)";

            return {
                ...stat,
                margin: margin,
                avgProfitPerGram: avgProfit,
                avgQtyPerTx: avgQty,
                avgSellingPrice: avgSell,
                behaviorPattern: pattern
            };
        })
        .sort((a,b) => b.totalGrams - a.totalGrams); // Sort by Volume (Grams) Purchased

      const pTrend = [];
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          const sales = invoices.filter(inv => inv.type === 'SALE' && inv.date === dateStr); 
          const profit = sales.reduce((acc, inv) => acc + (inv.profit || 0), 0);
          const grams = sales.reduce((acc, inv) => acc + inv.quantityGrams, 0);
          pTrend.push({ 
             date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), 
             profit: profit,
             ppg: grams > 0 ? profit / grams : 0
          });
      }

      return {
          customerData: data,
          totalProfit: totalProfitCalc,
          profitMargin: totalRevenueExTax > 0 ? (totalProfitCalc / totalRevenueExTax) * 100 : 0,
          profitTrendData: pTrend,
          dailyProfit: pTrend
      };
  }, [filteredInvoices, dateRange, invoices]);

  const supplierData: SupplierStat[] = useMemo(() => calculateSupplierStats(filteredInvoices), [filteredInvoices]);
  const turnoverStats = useMemo(() => calculateTurnoverStats(invoices, dateRange.start, dateRange.end), [invoices, dateRange]);
  
  const alerts: RiskAlert[] = useMemo(() => {
    const list: RiskAlert[] = [];
    if (agingStats.buckets['30+'] > 0) {
      list.push({ id: 'old-stock', severity: 'HIGH', context: 'Inventory', message: `${formatGrams(agingStats.buckets['30+'])} of gold is older than 30 days.` });
    }
    const recentSales = invoices.filter(i => i.type === 'SALE').slice(0, 5);
    if (recentSales.length > 0) {
       const recentMargin = recentSales.reduce((acc, i) => acc + (i.profit || 0), 0) / recentSales.reduce((acc, i) => acc + (i.taxableAmount || 0), 0);
       if (recentMargin < 0.005) { 
         list.push({ id: 'low-margin', severity: 'MEDIUM', context: 'Profit', message: 'Recent sales margins are critically low (< 0.5%).' });
       }
    }
    return list;
  }, [agingStats, invoices]);

  const initiateDelete = (id: string) => {
      setDeleteId(id);
      setDeletePassword('');
      setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
      if (deletePassword === 'QAZ@789') {
          if (deleteId) {
              const success = await deleteOrderFromSupabase(deleteId);
              if (success) {
                  // Reload from source of truth
                  await loadData();
                  addToast('SUCCESS', 'Record deleted and data recalculated.');
              } else {
                  addToast('ERROR', 'Failed to delete from server.');
              }
          }
          setShowDeleteModal(false);
          setDeleteId(null);
          setDeletePassword('');
      } else {
          addToast('ERROR', 'Incorrect Admin Password.');
      }
  };

  const handleInitEditName = (id: string, currentName: string) => {
      setEditNameId(id);
      setNewPartyName(currentName);
      setEditNamePassword('');
      setShowEditNameModal(true);
  };

  const confirmNameUpdate = async () => {
      if (editNamePassword === 'QAZ@456') {
          if (editNameId && newPartyName.trim()) {
              const success = await updateOrderPartyName(editNameId, newPartyName.trim());
              if (success) {
                  await loadData();
                  addToast('SUCCESS', 'Party name updated successfully.');
              } else {
                  addToast('ERROR', 'Failed to update name on server.');
              }
          }
          setShowEditNameModal(false);
          setEditNameId(null);
          setEditNamePassword('');
          setNewPartyName('');
      } else {
          addToast('ERROR', 'Incorrect Admin Password.');
      }
  };

  const handleAddInvoice = async (invoice: Invoice) => {
    // 1. Optimistic Update (Immediate UI feedback)
    const newInvoicesList = [invoice, ...invoices];
    const { updatedInvoices, updatedInventory } = recalculateAllData(newInvoicesList);
    setInvoices(updatedInvoices.reverse());
    setInventory(updatedInventory);
    
    // 2. Persist to Cloud
    const success = await saveOrderToSupabase(invoice);
    
    if (success) {
        addToast('SUCCESS', `${invoice.type === 'PURCHASE' ? 'Purchase' : 'Sale'} Saved to Cloud.`);
        // Reload strictly to ensure consistency with DB triggers/defaults
        // await loadData(); 
    } else {
        addToast('ERROR', 'Failed to save to cloud. Check connection.');
    }
  };

  const handleReset = () => {
      if(window.confirm("Are you sure? This will delete all data. This action cannot be undone.")) {
          resetData(); setInvoices([]); setInventory([]);
          addToast('SUCCESS', 'System Reset Complete');
      }
  }

  // --- EXPORT HANDLERS ---
  
  const generatePDF = (title: string, head: string[][], body: (string | number)[][], summary?: string[]) => {
      // Determine orientation based on column count (Threshold 8)
      const colCount = head[0]?.length || 0;
      const isLandscape = colCount > 7;
      
      const doc = new jsPDF({
          orientation: isLandscape ? 'landscape' : 'portrait',
          unit: 'mm',
          format: 'a4'
      });
      
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      // Theme Colors
      const goldColor = [209, 151, 38]; // #d19726
      const slateDark = [15, 23, 42];   // #0f172a
      
      // Helper to sanitize currency symbols for PDF
      const sanitize = (val: any) => String(val).replace(/₹/g, 'Rs. ');

      const sanitizedHead = head.map(row => row.map(sanitize));
      const sanitizedBody = body.map(row => row.map(sanitize));
      const sanitizedSummary = summary?.map(sanitize);

      // --- Header ---
      doc.setFillColor(slateDark[0], slateDark[1], slateDark[2]);
      doc.rect(0, 0, pageWidth, 40, 'F'); // Dark header background

      // Brand Name
      doc.setTextColor(goldColor[0], goldColor[1], goldColor[2]);
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text("BullionKeep AI", 14, 20);

      // Tagline
      doc.setTextColor(200, 200, 200);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("Private Inventory Intelligence", 14, 28);

      // Report Info (Right aligned in header)
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text(`Report: ${title}`, pageWidth - 14, 20, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, pageWidth - 14, 28, { align: 'right' });

      let yPos = 55;

      // --- Summary Section ---
      if (sanitizedSummary && sanitizedSummary.length > 0) {
          doc.setDrawColor(200, 200, 200);
          doc.setFillColor(250, 250, 250);
          
          // Calculate height needed
          const summaryHeight = (sanitizedSummary.length * 7) + 10;
          
          // Draw Box
          doc.roundedRect(14, yPos - 5, pageWidth - 28, summaryHeight, 2, 2, 'FD');
          
          // Left Gold Accent Border
          doc.setDrawColor(goldColor[0], goldColor[1], goldColor[2]);
          doc.setLineWidth(1.5);
          doc.line(14, yPos - 5, 14, yPos - 5 + summaryHeight);
          doc.setLineWidth(0.1); // Reset

          doc.setFontSize(11);
          doc.setTextColor(50, 50, 50);
          
          sanitizedSummary.forEach((line, i) => {
              doc.text(line, 20, yPos + (i * 7));
          });

          yPos += summaryHeight + 10;
      }

      // --- Table ---
      autoTable(doc, {
          startY: yPos,
          head: sanitizedHead,
          body: sanitizedBody,
          theme: 'grid',
          styles: {
              fontSize: isLandscape ? 7.5 : 9, // Smaller font for wider tables to fit data
              textColor: 50,
              cellPadding: 3, // Reduced padding
              lineWidth: 0.1,
              lineColor: [220, 220, 220],
              overflow: 'linebreak'
          },
          headStyles: {
              fillColor: slateDark as [number, number, number],
              textColor: [255, 255, 255],
              fontStyle: 'bold',
              halign: 'center'
          },
          alternateRowStyles: {
              fillColor: [248, 250, 252] // Very light slate
          },
          columnStyles: {
              0: { fontStyle: 'bold' } // First column often ID or Name
          },
          didDrawPage: (data) => {
              // Footer
              doc.setFontSize(8);
              doc.setTextColor(150);
              doc.text(`Page ${data.pageNumber} of ${doc.getNumberOfPages()}`, data.settings.margin.left, pageHeight - 10);
              
              doc.setTextColor(goldColor[0], goldColor[1], goldColor[2]);
              doc.setFont("helvetica", "bold");
              doc.text("STRATEGICALLY DIRECTED & MANAGED BY KUNAL", pageWidth - 14, pageHeight - 10, { align: 'right' });
          }
      });

      const fileName = `${title.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      addToast('SUCCESS', `${title} PDF downloaded.`);
  };

  const handleInventoryExport = (type: 'CSV' | 'PDF') => {
      const data = inventory.filter(inv => inv.date >= dateRange.start && inv.date <= dateRange.end).map(b => ({
          batchId: b.id, date: b.date, originalQty: b.originalQuantity, remainingQty: b.remainingQuantity, costPerGram: b.costPerGram, totalValue: b.remainingQuantity * b.costPerGram, status: b.remainingQuantity > 0 ? 'Active' : 'Closed'
      }));
      if (type === 'CSV') {
          const headers = ['Batch ID', 'Date', 'Original Qty (g)', 'Remaining Qty (g)', 'Cost (INR/g)', 'Total Value (INR)', 'Status'];
          const csv = [headers.join(','), ...data.map(r => [r.batchId, r.date, r.originalQty, r.remainingQty, r.costPerGram, r.totalValue, r.status].join(','))].join('\n');
          downloadCSV(csv, `inventory_report_${new Date().toISOString().split('T')[0]}.csv`);
          addToast('SUCCESS', 'Inventory CSV downloaded.');
      } else {
          generatePDF('Inventory Report', [['Batch ID', 'Date', 'Original (g)', 'Remaining (g)', 'Cost/g', 'Value', 'Status']], data.map(r => [r.batchId, r.date, formatGrams(r.originalQty), formatGrams(r.remainingQty), formatCurrency(r.costPerGram), formatCurrency(r.totalValue), r.status]));
      }
  };
  
  const handlePriceExport = (type: 'CSV' | 'PDF', purchases: Invoice[]) => {
       if (type === 'CSV') {
           const headers = ['Date', 'Supplier', 'Quantity (g)', 'Rate (INR/g)', 'Total (INR)'];
           const csv = [headers.join(','), ...purchases.map(p => [p.date, `"${p.partyName}"`, p.quantityGrams, p.ratePerGram, p.quantityGrams * p.ratePerGram].join(','))].join('\n');
           downloadCSV(csv, `price_analysis_purchases_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Price Data CSV downloaded.');
       } else {
           generatePDF('Price Analysis - Purchases', [['Date', 'Supplier', 'Qty (g)', 'Rate (INR/g)', 'Total (INR)']], purchases.map(p => [p.date, p.partyName, formatGrams(p.quantityGrams), formatCurrency(p.ratePerGram), formatCurrency(p.quantityGrams * p.ratePerGram)]));
       }
  };

  const handleCustomerExport = (type: 'CSV' | 'PDF') => {
       if (type === 'CSV') {
           const headers = ['Customer', 'Frequency', 'Total Grams', 'Revenue (Ex GST)', 'Avg Price', 'Avg Profit/g', 'Pattern'];
           const csv = [headers.join(','), ...customerData.map(c => [`"${c.name}"`, c.txCount, c.totalGrams, c.totalSpend, c.avgSellingPrice, c.avgProfitPerGram, c.behaviorPattern].join(','))].join('\n');
           downloadCSV(csv, `customer_insights_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Customer Data CSV downloaded.');
       } else {
           generatePDF('Customer Intelligence Report', [['Customer', 'Freq', 'Total Grams', 'Revenue (Ex GST)', 'Avg Price', 'Profit/g', 'Pattern']], customerData.map(c => [c.name, c.txCount, formatGrams(c.totalGrams), formatCurrency(c.totalSpend), formatCurrency(c.avgSellingPrice || 0), formatCurrency(c.avgProfitPerGram || 0), c.behaviorPattern || '']));
       }
  };

  const handleSupplierExport = (type: 'CSV' | 'PDF') => {
       if (type === 'CSV') {
           const headers = ['Supplier', 'Transactions', 'Total Volume (g)', 'Avg Rate', 'Min Rate', 'Max Rate', 'Volatility'];
           const csv = [headers.join(','), ...supplierData.map(s => [`"${s.name}"`, s.txCount, s.totalGramsPurchased, s.avgRate, s.minRate, s.maxRate, s.volatility].join(','))].join('\n');
           downloadCSV(csv, `supplier_insights_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Supplier Data CSV downloaded.');
       } else {
           generatePDF('Supplier Insights Report', [['Supplier', 'Tx Count', 'Vol (g)', 'Avg Rate', 'Min', 'Max', 'Volatility']], supplierData.map(s => [s.name, s.txCount, formatGrams(s.totalGramsPurchased), formatCurrency(s.avgRate), formatCurrency(s.minRate), formatCurrency(s.maxRate), formatCurrency(s.volatility)]));
       }
  };

  const handleLedgerExport = (type: 'CSV' | 'PDF', monthlyData: any[], totals: any) => {
      if (type === 'CSV') {
          const headers = ['Month', 'Turnover (Ex GST)', 'Profit', 'Margin %', 'Qty Sold'];
          const csv = [headers.join(','), ...monthlyData.map(m => [m.date.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}), m.turnover, m.profit, (m.turnover > 0 ? (m.profit/m.turnover)*100 : 0).toFixed(2), m.qty].join(','))].join('\n');
          downloadCSV(csv, `business_ledger_lifetime.csv`);
          addToast('SUCCESS', 'Ledger CSV downloaded.');
      } else {
          generatePDF('Business Performance Ledger', [['Month', 'Turnover (Ex GST)', 'Profit', 'Margin %', 'Qty Sold']], monthlyData.map(m => [m.date.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}), formatCurrency(m.turnover), formatCurrency(m.profit), (m.turnover > 0 ? (m.profit/m.turnover)*100 : 0).toFixed(2) + '%', formatGrams(m.qty)]), [`Total Turnover (Ex GST): ${formatCurrency(totals.turnover)}`, `Total Profit: ${formatCurrency(totals.profit)}`, `Overall Margin: ${totals.margin.toFixed(2)}%`, `Total Gold Sold: ${formatGrams(totals.qty)}`]);
      }
  };

  // --- FULL AUDIT HANDLER ---
  const handleFullAuditExport = (type: 'CSV' | 'PDF') => {
    if (type === 'CSV') {
        // Fallback to transaction raw data for CSV
        handleInvoicesExport('CSV');
        return;
    }

    // Calculate Audit Metrics
    const totalTurnover = invoices.filter(i => i.type === 'SALE').reduce((acc, i) => acc + i.taxableAmount, 0);
    const totalGstCollected = invoices.filter(i => i.type === 'SALE').reduce((acc, i) => acc + i.gstAmount, 0);
    const totalGstPaid = invoices.filter(i => i.type === 'PURCHASE').reduce((acc, i) => acc + i.gstAmount, 0);
    const netGst = totalGstCollected - totalGstPaid;
    
    // PDF Generation
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Branding Header (Same as generatePDF)
    const goldColor = [209, 151, 38];
    const slateDark = [15, 23, 42];
    
    doc.setFillColor(slateDark[0], slateDark[1], slateDark[2]);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(goldColor[0], goldColor[1], goldColor[2]);
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("BullionKeep AI", 14, 20);
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Full Business Audit Report", 14, 28);
    doc.setTextColor(255, 255, 255);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, pageWidth - 14, 28, { align: 'right' });

    let yPos = 50;

    // Executive Summary Box
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(14, yPos, pageWidth - 28, 35, 2, 2, 'FD');
    doc.setDrawColor(goldColor[0], goldColor[1], goldColor[2]);
    doc.setLineWidth(1.5);
    doc.line(14, yPos, 14, yPos + 35);
    doc.setLineWidth(0.1);
    
    doc.setFontSize(14);
    doc.setTextColor(50, 50, 50);
    doc.text("Executive Summary", 20, yPos + 10);
    
    doc.setFontSize(10);
    doc.text(`Current Stock: ${formatGrams(currentStock)}`, 20, yPos + 20);
    doc.text(`Stock Value (FIFO): ${formatCurrency(fifoValue)}`, 20, yPos + 28);
    
    doc.text(`Total Turnover: ${formatCurrency(totalTurnover)}`, 100, yPos + 20);
    doc.text(`Net Profit: ${formatCurrency(totalProfit)}`, 100, yPos + 28);

    yPos += 45;

    // Table 1: Inventory Aging
    doc.setFontSize(12);
    doc.setTextColor(slateDark[0], slateDark[1], slateDark[2]);
    doc.text("Risk & Aging Analysis", 14, yPos);
    yPos += 5;
    
    autoTable(doc, {
        startY: yPos,
        head: [['Aging Bucket', 'Quantity (g)', 'Status']],
        body: Object.entries(agingStats.buckets).map(([bucket, qty]) => [
            `${bucket} Days`, 
            formatGrams(qty), 
            bucket === '30+' && qty > 0 ? 'CRITICAL' : 'Normal'
        ]),
        theme: 'grid',
        headStyles: { fillColor: slateDark as [number, number, number] }
    });
    
    // @ts-ignore
    yPos = doc.lastAutoTable.finalY + 15;

    // Table 2: Tax Summary
    doc.text("Taxation Summary", 14, yPos);
    yPos += 5;
    
    autoTable(doc, {
        startY: yPos,
        head: [['Category', 'Amount']],
        body: [
            ['GST Collected (Sales)', formatCurrency(totalGstCollected)],
            ['GST Paid (Purchases)', formatCurrency(totalGstPaid)],
            ['Net GST Payable', formatCurrency(netGst)]
        ],
        theme: 'grid',
        headStyles: { fillColor: slateDark as [number, number, number] }
    });

    const fileName = `full_audit_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    addToast('SUCCESS', 'Full Audit Report downloaded.');
  };

  const handleInvoicesExport = (type: 'CSV' | 'PDF') => {
       const data = [...filteredInvoices].sort((a,b) => b.date.localeCompare(a.date));
       if (type === 'CSV') {
           const headers = ['Date', 'Type', 'Party', 'Qty (g)', 'Rate (INR/g)', 'My Cost (INR/g)', 'Taxable (Ex GST)', 'GST (INR)', 'Total (Inc GST)', 'My Total Cost (Ex GST)', 'Profit (Ex GST)'];
           const csv = [headers.join(','), ...data.map(i => {
                   const myCost = i.type === 'SALE' && i.cogs ? (i.cogs / i.quantityGrams) : 0;
                   const myTotalCost = i.type === 'SALE' ? (i.cogs || 0) : i.taxableAmount;
                   return [i.date, i.type, `"${i.partyName}"`, i.quantityGrams, i.ratePerGram, myCost > 0 ? myCost.toFixed(2) : '-', i.taxableAmount, i.gstAmount, i.totalAmount, myTotalCost, i.profit || 0].join(',')
               })].join('\n');
           downloadCSV(csv, `transactions_${dateRange.start}_${dateRange.end}.csv`);
           addToast('SUCCESS', 'Transactions CSV downloaded.');
       } else {
           generatePDF('Transaction Report', [['Date', 'Type', 'Party', 'Qty', 'Rate', 'My Cost', 'Taxable', 'GST', 'Total', 'My Total Cost', 'Profit']], data.map(i => {
                 const myCost = i.type === 'SALE' && i.cogs ? (i.cogs / i.quantityGrams) : 0;
                 const myTotalCost = i.type === 'SALE' ? (i.cogs || 0) : i.taxableAmount;
                 return [i.date, i.type.substring(0,1), i.partyName, formatGrams(i.quantityGrams), formatCurrency(i.ratePerGram), myCost > 0 ? formatCurrency(myCost) : '-', formatCurrency(i.taxableAmount), formatCurrency(i.gstAmount), formatCurrency(i.totalAmount), formatCurrency(myTotalCost), i.profit ? formatCurrency(i.profit) : '-']
             }));
       }
  };

  // --- SUB-VIEWS ---

  const DashboardView = () => {
       const qtySoldPeriod = filteredInvoices.filter(i => i.type === 'SALE').reduce((acc, i) => acc + i.quantityGrams, 0);
       const localCount = loadInvoices().length;
       const cloudCount = invoices.length;
       const hasMissing = localCount > cloudCount;

       return (
            <div className="space-y-8 animate-enter">
                <SectionHeader title="Executive Dashboard" subtitle="Real-time overview of inventory performance and alerts." action={renderDateFilter()}/>
                {dbError && (
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-red-700 shadow-sm flex items-center gap-4 animate-pulse-slow">
                        <div className="p-3 bg-red-100 rounded-full text-red-600"><Database className="w-6 h-6"/></div>
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-red-800">Database Connection Issue</h3>
                            <p className="text-sm font-medium opacity-90 mt-1">We cannot fetch your cloud data. This usually happens if the <strong>SQL Setup</strong> hasn't been run yet.</p>
                        </div>
                    </div>
                )}
                {/* Cloud Sync Card */}
                <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl shadow-slate-900/10 flex flex-col md:flex-row items-center justify-between gap-6 border border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                    <div className="flex items-center gap-5 relative z-10">
                        <div className={`p-3.5 rounded-2xl border ${hasMissing ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>{isSyncing ? <RefreshCw className="w-6 h-6 animate-spin"/> : <CloudCog className="w-6 h-6"/>}</div>
                        <div>
                            <h3 className="font-bold text-xl">Cloud Sync Status</h3>
                            <div className="flex gap-4 text-xs font-mono text-slate-400 mt-1.5 uppercase tracking-wider">
                                <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5"/> Cloud: {cloudCount}</span>
                                <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5"/> Local: {localCount}</span>
                            </div>
                        </div>
                    </div>
                    {hasMissing ? (
                         <div className="flex items-center gap-4 relative z-10">
                             <p className="text-sm font-medium text-amber-300">Unsynced records found.</p>
                             <button onClick={handleManualSync} disabled={isSyncing} className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 text-sm">{isSyncing ? 'Uploading...' : 'Sync Now'} <CloudUpload className="w-4 h-4"/></button>
                         </div>
                    ) : (
                        <div className="flex items-center gap-2 text-green-400 bg-green-950/30 px-4 py-2 rounded-xl border border-green-500/20 relative z-10"><CheckCircle className="w-4 h-4"/><span className="text-xs font-bold uppercase tracking-wide">Synchronized</span></div>
                    )}
                </div>
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatsCard title="Current Stock" value={formatGrams(currentStock)} subValue={`${inventory.filter(b=>b.remainingQuantity>0).length} active batches`} icon={Coins} delayIndex={0} isActive />
                    <StatsCard title="Inventory Value" value={formatCurrency(fifoValue)} subValue="FIFO Basis" icon={Briefcase} delayIndex={1} />
                    <StatsCard title="Total Profit" value={formatCurrency(totalProfit)} subValue="Realized (Period)" icon={TrendingUp} delayIndex={2} />
                    <StatsCard title="Avg. Aging" value={`${Math.round(agingStats.weightedAvgDays)} Days`} subValue="Stock Age" icon={Timer} delayIndex={3} />
                </div>
                {/* Charts Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                     <div className="lg:col-span-2 space-y-8">
                          <Card title="Business Health & Alerts" delay={4}>
                               {alerts.length === 0 ? (
                                   <div className="flex flex-col items-center justify-center h-32 text-slate-400 bg-slate-50 rounded-xl border border-slate-100 border-dashed"><CheckCircle className="w-8 h-8 mb-2 text-green-500 opacity-50" /><p className="text-sm font-medium">All systems healthy. No risk alerts.</p></div>
                               ) : (
                                   <div className="space-y-3">{alerts.map(alert => (<div key={alert.id} className={`flex items-start gap-4 p-4 rounded-xl border-l-4 ${alert.severity === 'HIGH' ? 'bg-red-50 border-l-red-500 border-y border-r border-slate-100 text-red-900' : 'bg-amber-50 border-l-amber-500 border-y border-r border-slate-100 text-amber-900'}`}><AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${alert.severity === 'HIGH' ? 'text-red-500' : 'text-amber-500'}`} /><div><p className="font-bold text-xs uppercase tracking-wide mb-1 opacity-70">{alert.context}</p><p className="text-sm font-semibold leading-relaxed">{alert.message}</p></div></div>))}</div>
                               )}
                          </Card>
                          <Card title="Recent Activity" delay={5}>
                               <div className="space-y-1">
                                {invoices.slice(0, 5).map((inv, idx) => (
                                  <div key={inv.id} className={`flex items-center justify-between p-4 hover:bg-slate-50 rounded-xl transition-all group ${idx !== invoices.slice(0,5).length -1 ? 'border-b border-slate-50' : ''}`}>
                                    <div className="flex items-center gap-4">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${inv.type === 'PURCHASE' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                                        {inv.type === 'PURCHASE' ? <ArrowRightLeft className="w-4 h-4"/> : <Coins className="w-4 h-4"/>}
                                      </div>
                                      <div>
                                        <p className="font-bold text-slate-900 text-sm group-hover:text-gold-600 transition-colors">{inv.partyName}</p>
                                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{new Date(inv.date).toLocaleDateString()}</p>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <p className="font-mono font-bold text-sm text-slate-900">{formatGrams(inv.quantityGrams)}</p>
                                      <p className="text-xs text-slate-500 font-medium">{formatCurrency(inv.totalAmount)}</p>
                                    </div>
                                  </div>
                                ))}
                               </div>
                          </Card>
                     </div>
                     <div className="space-y-8">
                          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-8 text-white shadow-xl flex flex-col items-center text-center justify-center min-h-[220px] relative overflow-hidden border border-slate-800">
                               <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
                               <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
                               <h3 className="relative z-10 text-4xl font-mono font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-gold-300 to-gold-500">{formatGrams(qtySoldPeriod)}</h3>
                               <p className="relative z-10 text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">Volume Sold (Period)</p>
                          </div>
                          <Card title="Stock Aging" delay={6}>
                               <div className="space-y-5 pt-2">{Object.entries(agingStats.buckets).map(([range, qty]) => (<div key={range}><div className="flex justify-between text-xs mb-2"><span className="font-bold text-slate-500 uppercase tracking-wider">{range} Days</span><span className="font-mono font-bold text-slate-700">{formatGrams(qty)}</span></div><div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${range === '30+' ? 'bg-red-500' : 'bg-gradient-to-r from-gold-400 to-gold-600'}`} style={{ width: `${currentStock > 0 ? (qty / currentStock) * 100 : 0}%` }}></div></div></div>))}</div>
                          </Card>
                     </div>
                </div>
            </div>
       );
  };
  
  const CustomerInsightsView = () => {
    const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

    // Filter unique customers who have made purchases (SALES) in the current date range
    const activeCustomers = useMemo(() => {
        const stats: Record<string, { count: number, totalVol: number }> = {};
        filteredInvoices.filter(i => i.type === 'SALE').forEach(inv => {
            if(!stats[inv.partyName]) stats[inv.partyName] = { count: 0, totalVol: 0 };
            stats[inv.partyName].count += 1;
            stats[inv.partyName].totalVol += inv.quantityGrams;
        });
        return Object.entries(stats)
            .map(([name, val]) => ({ name, ...val }))
            .sort((a,b) => b.totalVol - a.totalVol);
    }, [filteredInvoices]);

    // Calculate aggregated stats for the selected customer
    const selectedCustomerStats = useMemo(() => {
        if (!selectedCustomer) return null;
        const txs = filteredInvoices.filter(i => i.type === 'SALE' && i.partyName === selectedCustomer);
        const totalVol = txs.reduce((sum, i) => sum + i.quantityGrams, 0);
        const totalRev = txs.reduce((sum, i) => sum + i.taxableAmount, 0);
        const totalProfit = txs.reduce((sum, i) => sum + (i.profit || 0), 0);
        const avgMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;
        
        return {
            totalVol,
            totalRev,
            totalProfit,
            avgMargin,
            txs: txs.sort((a,b) => b.date.localeCompare(a.date)) // Recent first
        };
    }, [selectedCustomer, filteredInvoices]);

    const handleSingleCustomerExport = (type: 'CSV' | 'PDF') => {
        if (!selectedCustomer || !selectedCustomerStats) return;
        
        const { txs, totalVol, totalRev, totalProfit, avgMargin } = selectedCustomerStats;
        const filename = `${selectedCustomer.replace(/\s+/g, '_')}_sales_history`;

        if (type === 'CSV') {
            const headers = ['Date', 'Volume (g)', 'Rate (INR/g)', 'Sale Value (Ex GST)', 'Profit', 'Margin %'];
            const rows = txs.map(sale => {
                const margin = sale.taxableAmount > 0 ? ((sale.profit || 0) / sale.taxableAmount) * 100 : 0;
                return [
                    sale.date,
                    sale.quantityGrams,
                    sale.ratePerGram,
                    sale.taxableAmount,
                    sale.profit || 0,
                    margin.toFixed(2)
                ].join(',');
            });
            const csvContent = [headers.join(','), ...rows].join('\n');
            downloadCSV(csvContent, `${filename}.csv`);
            addToast('SUCCESS', 'Customer history CSV downloaded.');
        } else {
            // PDF
            const head = [['Date', 'Volume (g)', 'Rate', 'Sale Value', 'Profit', 'Margin %']];
            const body = txs.map(sale => {
                const margin = sale.taxableAmount > 0 ? ((sale.profit || 0) / sale.taxableAmount) * 100 : 0;
                return [
                    sale.date,
                    formatGrams(sale.quantityGrams),
                    formatCurrency(sale.ratePerGram),
                    formatCurrency(sale.taxableAmount),
                    formatCurrency(sale.profit || 0),
                    `${margin.toFixed(2)}%`
                ];
            });
            const summary = [
                `Customer: ${selectedCustomer}`,
                `Period: ${new Date(dateRange.start).toLocaleDateString()} - ${new Date(dateRange.end).toLocaleDateString()}`,
                `Total Volume: ${formatGrams(totalVol)}`,
                `Total Revenue: ${formatCurrency(totalRev)}`,
                `Total Profit: ${formatCurrency(totalProfit)}`,
                `Avg Margin: ${avgMargin.toFixed(2)}%`
            ];
            generatePDF(`Sales History: ${selectedCustomer}`, head, body, summary);
        }
    };

    return (
        <div className="space-y-8 animate-enter">
            <SectionHeader title="Customer Intelligence" subtitle="Analyze purchasing patterns and profitability." action={<div className="flex gap-3 items-center"><ExportMenu onExport={(t) => initiateExport(handleSingleCustomerExport, t)} />{renderDateFilter()}</div>}/>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">{customerData.slice(0, 3).map((c, i) => (<div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg transition-all flex flex-col gap-4 relative overflow-hidden group"><div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full -mr-8 -mt-8 group-hover:scale-125 transition-transform duration-500"></div><div className="flex justify-between items-start z-10"><div><h3 className="font-bold text-lg text-slate-900 truncate max-w-[150px] group-hover:text-purple-700 transition-colors">{c.name}</h3><p className="text-[10px] font-bold bg-purple-50 text-purple-600 px-2 py-1 rounded-md inline-block mt-1 uppercase tracking-wider">{c.behaviorPattern}</p></div><div className="p-2.5 bg-slate-50 rounded-xl text-slate-400 group-hover:bg-purple-50 group-hover:text-purple-600 transition-colors"><Users className="w-5 h-5"/></div></div><div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4 z-10"><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total Grams</p><p className="font-mono font-bold text-slate-800">{formatGrams(c.totalGrams)}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Revenue</p><p className="font-mono font-bold text-slate-800">{formatCurrency(c.totalSpend)}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Frequency</p><p className="font-mono font-bold text-slate-800">{c.txCount} Tx</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Avg Price/g</p><p className="font-mono font-bold text-slate-800">{formatCurrency(c.avgSellingPrice || 0)}</p></div></div></div>))}</div>
            <Card title="Top 10 Customer Rankings">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-separate border-spacing-y-2">
                        <thead className="text-slate-400">
                            <tr>
                                <th className="px-4 py-2 text-center w-16 font-bold uppercase text-[10px] tracking-wider">Rank</th>
                                <th className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">Customer</th>
                                <th className="px-4 py-2 text-center font-bold uppercase text-[10px] tracking-wider">Tx Count</th>
                                <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Volume (g)</th>
                                <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Revenue</th>
                                <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Avg Rate</th>
                                <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {customerData.slice(0, 10).map((c, i) => (
                                <tr key={i} className="bg-white hover:bg-slate-50 transition-colors group">
                                    <td className="px-4 py-3 text-center border-y border-l border-slate-100 rounded-l-xl">
                                        {i < 3 ? (
                                            <span className={`flex items-center justify-center w-6 h-6 rounded-full mx-auto font-bold text-xs ${i === 0 ? 'bg-gold-100 text-gold-700' : i === 1 ? 'bg-slate-200 text-slate-700' : 'bg-orange-100 text-orange-800'}`}>
                                                {i + 1}
                                            </span>
                                        ) : <span className="text-slate-400 text-xs font-mono">#{i + 1}</span>}
                                    </td>
                                    <td className="px-4 py-3 border-y border-slate-100">
                                        <p className="font-bold text-slate-800 text-sm group-hover:text-gold-600 transition-colors">{c.name}</p>
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">{c.behaviorPattern}</p>
                                    </td>
                                    <td className="px-4 py-3 text-center border-y border-slate-100 text-slate-500 font-medium text-xs">{c.txCount}</td>
                                    <td className="px-4 py-3 text-right border-y border-slate-100 font-mono font-bold text-slate-800">{formatGrams(c.totalGrams)}</td>
                                    <td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-600 text-xs">{formatCurrency(c.totalSpend)}</td>
                                    <td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-500 text-xs">{formatCurrency(c.avgSellingPrice || 0)}</td>
                                    <td className="px-4 py-3 text-right border-y border-r border-slate-100 rounded-r-xl font-mono font-bold text-green-600">{formatCurrency(c.profitContribution)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
            
            <Card title="Sales Ledger & Drilldown">
                {!selectedCustomer ? (
                    // Master View: List of Customers
                    <div className="space-y-4">
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs font-medium text-slate-500 flex items-center gap-2">
                             <Info className="w-4 h-4 text-blue-500"/> Select a customer row to view detailed transaction history.
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-slate-500 border-b border-slate-100">
                                    <tr>
                                        <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider">Customer Name</th>
                                        <th className="px-4 py-3 text-center font-bold uppercase text-[10px] tracking-wider">Transactions</th>
                                        <th className="px-4 py-3 text-right font-bold uppercase text-[10px] tracking-wider">Total Volume (Period)</th>
                                        <th className="px-4 py-3 text-center font-bold uppercase text-[10px] tracking-wider">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeCustomers.length === 0 ? (
                                        <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400 italic">No active customers in this period.</td></tr>
                                    ) : (
                                        activeCustomers.map((c, i) => (
                                            <tr key={i} className="hover:bg-slate-50 border-b border-slate-50 group cursor-pointer transition-colors" onClick={() => setSelectedCustomer(c.name)}>
                                                <td className="px-4 py-3 font-semibold text-slate-800 group-hover:text-gold-600 transition-colors">{c.name}</td>
                                                <td className="px-4 py-3 text-center text-slate-500">{c.count}</td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">{formatGrams(c.totalVol)}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <button className="p-2 bg-slate-100 rounded-lg text-slate-400 group-hover:bg-gold-500 group-hover:text-white transition-all">
                                                        <ChevronRight className="w-4 h-4"/>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    // Detail View: Specific Customer History
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={() => setSelectedCustomer(null)}
                                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors uppercase tracking-wide"
                                >
                                    <ChevronLeft className="w-3 h-3"/> Back
                                </button>
                                <h3 className="text-xl font-bold text-slate-800">{selectedCustomer}</h3>
                            </div>
                            <ExportMenu onExport={(t) => initiateExport(handleSingleCustomerExport, t)} />
                        </div>

                        {/* Summary Header for Selected Customer */}
                        {selectedCustomerStats && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
                                <div className="bg-white p-5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Stock Bought</p>
                                    <p className="text-2xl font-mono font-bold text-slate-900">{formatGrams(selectedCustomerStats.totalVol)}</p>
                                </div>
                                <div className="bg-white p-5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Revenue</p>
                                    <p className="text-2xl font-mono font-bold text-slate-900">{formatCurrency(selectedCustomerStats.totalRev)}</p>
                                </div>
                                <div className="bg-white p-5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Profit</p>
                                    <p className="text-2xl font-mono font-bold text-green-600">{formatCurrency(selectedCustomerStats.totalProfit)}</p>
                                </div>
                                <div className="bg-white p-5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Margin</p>
                                    <p className={`text-2xl font-mono font-bold ${selectedCustomerStats.avgMargin < 1 ? 'text-red-500' : 'text-green-600'}`}>
                                        {selectedCustomerStats.avgMargin.toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-slate-500 bg-slate-50 border-y border-slate-100">
                                    <tr>
                                        <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider">Date</th>
                                        <th className="px-4 py-3 text-right font-bold uppercase text-[10px] tracking-wider">Volume (g)</th>
                                        <th className="px-4 py-3 text-right font-bold uppercase text-[10px] tracking-wider">Rate</th>
                                        <th className="px-4 py-3 text-right font-bold uppercase text-[10px] tracking-wider">Sale Value</th>
                                        <th className="px-4 py-3 text-right font-bold uppercase text-[10px] tracking-wider">Profit</th>
                                        <th className="px-4 py-3 text-right font-bold uppercase text-[10px] tracking-wider">Margin %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedCustomerStats?.txs.map((sale) => {
                                        const margin = sale.taxableAmount > 0 ? ((sale.profit || 0) / sale.taxableAmount) * 100 : 0;
                                        return (
                                            <tr key={sale.id} className="hover:bg-slate-50 border-b border-slate-50 transition-colors">
                                                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{sale.date}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-700 font-medium">{formatGrams(sale.quantityGrams)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-500 text-xs">{formatCurrency(sale.ratePerGram)}</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(sale.taxableAmount)}</td>
                                                <td className={`px-4 py-3 text-right font-mono font-bold ${(sale.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {formatCurrency(sale.profit || 0)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">
                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${margin >= 1 ? 'bg-green-100 text-green-700' : margin >= 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                                        {margin.toFixed(2)}%
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
  }

  const SupplierInsightsView = () => {
    // Colors for Supplier Pie Chart (Blue/Indigo Spectrum)
    const SUPPLIER_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#818cf8', '#c084fc', '#e879f9', '#2dd4bf'];

    const supplierPieData = useMemo(() => {
        return supplierData.map(s => ({
            name: s.name,
            value: s.totalGramsPurchased
        })).sort((a,b) => b.value - a.value);
    }, [supplierData]);

    return (
        <div className="space-y-8 animate-enter">
            <SectionHeader title="Supplier Insights" subtitle="Track supplier performance and rate volatility." action={<div className="flex gap-3 items-center"><ExportMenu onExport={(t) => initiateExport(handleSupplierExport, t)} />{renderDateFilter()}</div>}/>
            
            {/* Top 3 Supplier Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">{supplierData.slice(0, 3).map((s, i) => (<div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg transition-all flex flex-col gap-4 relative overflow-hidden group"><div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full -mr-8 -mt-8 group-hover:scale-125 transition-transform duration-500"></div><div className="flex justify-between items-start z-10"><div><h3 className="font-bold text-lg text-slate-900 truncate max-w-[150px] group-hover:text-blue-600 transition-colors">{s.name}</h3><p className={`text-[10px] font-bold px-2 py-1 rounded-md inline-block mt-1 uppercase tracking-wider ${s.volatility > 50 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{s.volatility > 50 ? 'High Volatility' : 'Stable Rates'}</p></div><div className="p-2.5 bg-slate-50 rounded-xl text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors"><Factory className="w-5 h-5"/></div></div><div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4 z-10"><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Total Bought</p><p className="font-mono font-bold text-slate-800">{formatGrams(s.totalGramsPurchased)}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Avg Rate</p><p className="font-mono font-bold text-slate-800">{formatCurrency(s.avgRate)}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Transactions</p><p className="font-mono font-bold text-slate-800">{s.txCount}</p></div><div><p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Spread</p><p className="font-mono font-bold text-slate-800">{formatCurrency(s.volatility)}</p></div></div></div>))}</div>
            
            {/* Chart + Table Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Dependency Pie Chart */}
                <Card title="Supplier Dependency" className="lg:col-span-1 min-h-[400px]">
                    <div className="h-[350px] w-full flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={supplierPieData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={90}
                                    paddingAngle={2}
                                    cornerRadius={4}
                                    stroke="none"
                                >
                                    {supplierPieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={SUPPLIER_COLORS[index % SUPPLIER_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const data = payload[0].payload;
                                            return (
                                                <div className="bg-white/95 backdrop-blur-md p-3 border border-blue-100 shadow-xl rounded-xl">
                                                    <p className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">{data.name}</p>
                                                    <p className="text-lg font-mono font-bold text-blue-600">{formatGrams(data.value)}</p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Legend 
                                    layout="horizontal" 
                                    verticalAlign="bottom" 
                                    align="center"
                                    wrapperStyle={{ fontSize: '10px', paddingTop: '20px', fontWeight: 500 }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* Detailed Table */}
                <div className="lg:col-span-2">
                    <Card title="Detailed Supplier Ledger" className="h-full">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left border-separate border-spacing-y-2">
                                <thead className="text-slate-400">
                                    <tr>
                                        <th className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">Supplier</th>
                                        <th className="px-4 py-2 text-center font-bold uppercase text-[10px] tracking-wider">Tx Count</th>
                                        <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Volume (g)</th>
                                        <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Avg Rate</th>
                                        <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Min Rate</th>
                                        <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Max Rate</th>
                                        <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Spread</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {supplierData.map((s, i) => (
                                        <tr key={i} className="bg-white hover:bg-slate-50 transition-colors group">
                                            <td className="px-4 py-3 border-y border-l border-slate-100 rounded-l-xl font-bold text-slate-800">{s.name}</td>
                                            <td className="px-4 py-3 text-center border-y border-slate-100 text-slate-500 text-xs font-medium">{s.txCount}</td>
                                            <td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-700 font-bold">{formatGrams(s.totalGramsPurchased)}</td>
                                            <td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-blue-600 text-xs font-medium">{formatCurrency(s.avgRate)}</td>
                                            <td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-400 text-xs">{formatCurrency(s.minRate)}</td>
                                            <td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-400 text-xs">{formatCurrency(s.maxRate)}</td>
                                            <td className="px-4 py-3 text-right border-y border-r border-slate-100 rounded-r-xl font-mono font-bold text-slate-600 text-xs">{formatCurrency(s.volatility)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
  }

  const PriceAnalysisView = () => {
       const priceMetrics = useMemo(() => {
          const purchases = filteredInvoices.filter(i => i.type === 'PURCHASE');
          const sales = filteredInvoices.filter(i => i.type === 'SALE');
          const trendData = [];
          const start = new Date(dateRange.start);
          const end = new Date(dateRange.end);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const dateStr = d.toISOString().split('T')[0];
              const daySales = sales.filter(inv => inv.date === dateStr);
              const totalVal = daySales.reduce((acc, i) => acc + (i.ratePerGram * i.quantityGrams), 0);
              const totalQty = daySales.reduce((acc, i) => acc + i.quantityGrams, 0);
              trendData.push({ date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), avgSellPrice: totalQty > 0 ? totalVal / totalQty : null });
          }
          return { trendData, purchases };
      }, [filteredInvoices, dateRange]);

      return (
        <div className="space-y-8 animate-enter">
             <SectionHeader title="Price Intelligence & Spread Analysis" subtitle="Pricing trends, spreads, and supplier consistency." action={<div className="flex gap-3 items-center"><ExportMenu onExport={(t) => initiateExport((type) => handlePriceExport(type, priceMetrics.purchases), t)} />{renderDateFilter()}</div>}/>
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <Card title="Selling Price Trend (Avg/g)" delay={100} className="min-h-[400px]">
                    <div className="h-full w-full">
                        <ResponsiveContainer>
                            <LineChart data={priceMetrics.trendData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#334155" : "#e2e8f0"} />
                                <XAxis 
                                    dataKey="date" 
                                    axisLine={{ stroke: '#e2e8f0' }} 
                                    tickLine={false} 
                                    tick={{fill: '#64748b', fontSize: 10, fontWeight: 500}} 
                                    dy={10}
                                />
                                <YAxis 
                                    domain={['auto', 'auto']} 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{fill: '#64748b', fontSize: 10}} 
                                    tickFormatter={(v) => `₹${v}`} 
                                />
                                <Tooltip 
                                    cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', backgroundColor: '#fff', color: '#000' }} 
                                    formatter={(val:number) => [formatCurrency(val), 'Avg Sell Price']}
                                />
                                <Line 
                                    type="linear" // Changed from monotone to linear to match the 'straight' segments in the sample image
                                    dataKey="avgSellPrice" 
                                    stroke="#b4761e" 
                                    strokeWidth={3} 
                                    dot={{ r: 4, fill: "#b4761e", stroke: "#fff", strokeWidth: 2 }} // Distinct markers like the image
                                    activeDot={{ r: 6, fill: "#b4761e", stroke: "#fff", strokeWidth: 2 }} 
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                 </Card>
                 <Card title="Supplier Cost Consistency" delay={200} className="min-h-[400px]"><div className="overflow-x-auto"><table className="w-full text-sm text-left border-separate border-spacing-y-2"><thead className="text-slate-400"><tr><th className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">Supplier</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Avg Rate</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Min Rate</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Max Rate</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Spread</th></tr></thead><tbody>{supplierData.map((s, i) => (<tr key={i} className="bg-white hover:bg-slate-50 transition-colors"><td className="px-4 py-3 border-y border-l border-slate-100 rounded-l-xl font-medium text-slate-900">{s.name}</td><td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-blue-600 text-xs font-bold">{formatCurrency(s.avgRate)}</td><td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-500 text-xs">{formatCurrency(s.minRate)}</td><td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-500 text-xs">{formatCurrency(s.maxRate)}</td><td className="px-4 py-3 text-right border-y border-r border-slate-100 rounded-r-xl font-mono font-bold text-slate-700 text-xs">{formatCurrency(s.volatility)}</td></tr>))}</tbody></table></div></Card>
             </div>
             <Card title="Detailed Purchase Transactions" delay={300}><div className="overflow-x-auto"><table className="w-full text-sm text-left border-separate border-spacing-y-2"><thead className="text-slate-400"><tr><th className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">Date</th><th className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">Supplier</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Qty (g)</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Rate (₹/g)</th><th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Total</th></tr></thead><tbody>{priceMetrics.purchases.length === 0 ? (<tr><td colSpan={5} className="text-center py-12 text-slate-400 italic">No purchases in this period.</td></tr>) : priceMetrics.purchases.sort((a,b) => b.date.localeCompare(a.date)).map(inv => (<tr key={inv.id} className="bg-white hover:bg-slate-50 transition-colors"><td className="px-4 py-3 border-y border-l border-slate-100 rounded-l-xl text-slate-500 text-xs font-mono">{inv.date}</td><td className="px-4 py-3 border-y border-slate-100 font-medium text-slate-900">{inv.partyName}</td><td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-slate-700 font-bold">{formatGrams(inv.quantityGrams)}</td><td className="px-4 py-3 text-right border-y border-slate-100 font-mono text-blue-600 text-xs">{formatCurrency(inv.ratePerGram)}</td><td className="px-4 py-3 text-right border-y border-r border-slate-100 rounded-r-xl font-mono text-slate-700 font-medium text-xs">{formatCurrency(inv.taxableAmount)}</td></tr>))}</tbody></table></div></Card>
        </div>
      );
  }

  const AnalyticsView = () => {
      const realizedProfit = totalProfit; 
      const rate = parseFloat(marketRate);
      const hasRate = !isNaN(rate) && rate > 0;
      const unrealizedProfit = hasRate ? (currentStock * rate) - fifoValue : 0;
      
      const pieData = useMemo(() => {
          const stats: Record<string, number> = {};
          filteredInvoices.forEach(inv => {
             if (inv.type === 'SALE') {
                 stats[inv.partyName] = (stats[inv.partyName] || 0) + inv.quantityGrams;
             }
          });
          return Object.entries(stats)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
      }, [filteredInvoices]);

      const GREEN_SHADES = [
        '#022c22', '#064e3b', '#065f46', '#047857', '#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#0f766e', '#14b8a6', '#2dd4bf'
      ];

      return (
      <div className="space-y-8 animate-enter"><SectionHeader title="Analytics & Reports" subtitle="Deep dive into your business performance." action={<div className="flex gap-3 items-center"><ExportMenu onExport={(t) => initiateExport((type) => addToast('SUCCESS', 'For detailed exports, use specific sections or Generate PDF below.'), t)} />{renderDateFilter()}</div>}/>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"><StatsCard title="Inventory Turnover" value={`${turnoverStats.turnoverRatio.toFixed(2)}x`} subValue="Ratio (COGS / Avg Inv)" icon={Activity} isActive /><StatsCard title="Avg Days to Sell" value={`${Math.round(turnoverStats.avgDaysToSell)} Days`} subValue="Velocity" icon={Timer} /><StatsCard title="Realized Profit" value={formatCurrency(realizedProfit)} subValue="From Sales" icon={Wallet} /><div className="bg-slate-900 rounded-2xl p-6 text-white relative overflow-hidden flex flex-col justify-center shadow-xl border border-slate-800"><div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/10 rounded-full blur-3xl -mr-8 -mt-8 animate-pulse"></div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Unrealized Profit (Est)</p><div className="flex items-center gap-2 mb-2"><span className="text-slate-500 text-sm">@</span><input type="number" placeholder="Mkt Rate..." value={marketRate} onChange={(e) => setMarketRate(e.target.value)} className="w-28 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-gold-500 outline-none transition-all placeholder:text-slate-600"/></div><h3 className={`text-3xl font-mono font-bold tracking-tight ${unrealizedProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{hasRate ? formatCurrency(unrealizedProfit) : '---'}</h3></div></div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
                { 
                    id: 'CUSTOMER', 
                    title: 'Customer Report', 
                    icon: Users, 
                    color: 'text-purple-600', 
                    bg: 'bg-purple-50',
                    handler: () => initiateExport(handleCustomerExport, 'PDF')
                },
                { 
                    id: 'SUPPLIER', 
                    title: 'Supplier Report', 
                    icon: Factory, 
                    color: 'text-blue-600', 
                    bg: 'bg-blue-50',
                    handler: () => initiateExport(handleSupplierExport, 'PDF')
                },
                { 
                    id: 'CONSOLIDATED', 
                    title: 'Full Audit', 
                    icon: FileText, 
                    color: 'text-gold-600', 
                    bg: 'bg-gold-50',
                    handler: () => initiateExport(handleFullAuditExport, 'PDF')
                }
            ].map((rpt, i) => (
                <div 
                    key={rpt.id} 
                    onClick={rpt.handler} 
                    className="group bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer flex items-center gap-5 animate-slide-up" 
                    style={{ animationDelay: `${i*100}ms` }}
                >
                    <div className={`p-4 rounded-xl ${rpt.bg} ${rpt.color} group-hover:scale-110 transition-transform duration-300`}>
                        <rpt.icon className="w-6 h-6"/>
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 text-lg group-hover:text-gold-600 transition-colors">{rpt.title}</h3>
                        <p className="text-slate-400 text-xs mt-1 font-medium uppercase tracking-wide">Generate PDF</p>
                    </div>
                    <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0">
                        <Download className="w-5 h-5 text-slate-300"/>
                    </div>
                </div>
            ))}
        </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card title="Profit Trend" className="lg:col-span-2" delay={300}><div className="h-72 w-full"><ResponsiveContainer><AreaChart data={profitTrendData}><defs><linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, dy: 10}}/><YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} tickFormatter={(v) => `${v/1000}k`}/><Tooltip contentStyle={{backgroundColor: '#fff', borderRadius: '12px', border: 'none', color: '#000', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'}} formatter={(value: number) => [formatCurrency(value), 'Net Profit']}/><Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorProfit)" /></AreaChart></ResponsiveContainer></div></Card>
          
          <Card title="Customer Volume Share" className="lg:col-span-1 min-h-[400px]" delay={400}>
                <div className="h-[350px] w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={pieData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={70}
                                outerRadius={90}
                                paddingAngle={2}
                                cornerRadius={4}
                                stroke="none"
                            >
                                {pieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={GREEN_SHADES[index % GREEN_SHADES.length]} />
                                ))}
                            </Pie>
                            <Tooltip 
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-white/95 backdrop-blur-md p-3 border border-emerald-100 shadow-xl rounded-xl">
                                                <p className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">{data.name}</p>
                                                <p className="text-lg font-mono font-bold text-emerald-600">{formatGrams(data.value)}</p>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
          </Card>
      </div></div>
      );
  }

  const BusinessLedgerView = () => {
      const { monthlyData, totals } = useMemo(() => {
          const stats: Record<string, { turnover: number, profit: number, tax: number, qty: number }> = {};
          let totalTurnover = 0;
          let totalProfit = 0;
          let totalQty = 0;

          invoices.filter(i => i.type === 'SALE').forEach(inv => {
                const parts = inv.date.split('-');
                if (parts.length !== 3) return;
                const year = parseInt(parts[0]);
                const monthIndex = parseInt(parts[1]) - 1;
                const key = `${year}-${monthIndex}`;
                
                if (!stats[key]) stats[key] = { turnover: 0, profit: 0, tax: 0, qty: 0 };
                
                stats[key].turnover += inv.taxableAmount || 0;
                stats[key].profit += inv.profit || 0;
                stats[key].tax += inv.gstAmount || 0;
                stats[key].qty += inv.quantityGrams || 0;

                totalTurnover += inv.taxableAmount || 0;
                totalProfit += inv.profit || 0;
                totalQty += inv.quantityGrams || 0;
          });

          const monthly = Object.entries(stats).map(([key, val]) => {
              const [y, m] = key.split('-');
              return { date: new Date(parseInt(y), parseInt(m), 1), ...val };
          }).sort((a,b) => b.date.getTime() - a.date.getTime());

          const totalMargin = totalTurnover > 0 ? (totalProfit / totalTurnover) * 100 : 0;

          return { monthlyData: monthly, totals: { turnover: totalTurnover, profit: totalProfit, qty: totalQty, margin: totalMargin } };
      }, [invoices]);

      return (
          <div className="space-y-8 animate-enter">
              <SectionHeader 
                   title="Business Ledger" 
                   subtitle="Monthly financial breakdown and performance." 
                   action={<ExportMenu onExport={(t) => initiateExport((type) => handleLedgerExport(type, monthlyData, totals), t)} />}
              />

              <div className="bg-slate-900 rounded-2xl p-8 text-white flex flex-col md:flex-row justify-between items-center shadow-2xl shadow-slate-900/20 mb-8 border border-slate-800">
                  <div className="text-center md:text-left mb-6 md:mb-0">
                      <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-2">Lifetime Turnover (Ex GST)</p>
                      <h2 className="text-4xl md:text-5xl font-mono font-bold text-white mb-2">{formatCurrency(totals.turnover)}</h2>
                      <div className="flex items-center gap-3">
                          <span className="bg-green-500/10 text-green-400 px-3 py-1 rounded-lg text-xs font-bold border border-green-500/20">Net Profit: {formatCurrency(totals.profit)}</span>
                          <span className="text-slate-500 text-xs font-medium">Margin: {totals.margin.toFixed(2)}%</span>
                      </div>
                  </div>
                  <div className="flex gap-10 border-t md:border-t-0 md:border-l border-slate-700/50 pt-6 md:pt-0 md:pl-10">
                       <div>
                           <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Total Gold Sold</p>
                           <p className="text-2xl font-mono font-bold">{formatGrams(totals.qty)}</p>
                       </div>
                       <div>
                           <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Active Batches</p>
                           <p className="text-2xl font-mono font-bold">{inventory.filter(b => b.remainingQuantity > 0).length}</p>
                       </div>
                  </div>
              </div>

              <Card title="Monthly Breakdown">
                  <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-separate border-spacing-y-2">
                          <thead className="text-slate-400">
                              <tr>
                                  <th className="px-4 py-2 font-bold uppercase text-[10px] tracking-wider">Month</th>
                                  <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Turnover (Ex GST)</th>
                                  <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">GST Collected</th>
                                  <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Net Profit</th>
                                  <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Margin %</th>
                                  <th className="px-4 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Qty Sold</th>
                              </tr>
                          </thead>
                          <tbody>
                              {monthlyData.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 italic">No sales data recorded yet.</td></tr>
                              ) : (
                                monthlyData.map((m, i) => (
                                  <tr key={i} className="bg-white hover:bg-slate-50 transition-colors group">
                                      <td className="px-4 py-3 border-y border-l border-slate-100 rounded-l-xl font-bold text-slate-800">{m.date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</td>
                                      <td className="px-4 py-3 border-y border-slate-100 text-right font-mono text-slate-700">{formatCurrency(m.turnover)}</td>
                                      <td className="px-4 py-3 border-y border-slate-100 text-right font-mono text-slate-500 text-xs">{formatCurrency(m.tax)}</td>
                                      <td className="px-4 py-3 border-y border-slate-100 text-right font-mono text-green-600 font-bold">{formatCurrency(m.profit)}</td>
                                      <td className="px-4 py-3 border-y border-slate-100 text-right font-mono">
                                          <span className={`px-2 py-1 rounded text-[10px] font-bold ${m.turnover > 0 && (m.profit/m.turnover) > 0.01 ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-600'}`}>
                                              {(m.turnover > 0 ? (m.profit/m.turnover)*100 : 0).toFixed(2)}%
                                          </span>
                                      </td>
                                      <td className="px-4 py-3 border-y border-r border-slate-100 rounded-r-xl text-right font-mono text-slate-600">{formatGrams(m.qty)}</td>
                                  </tr>
                                ))
                              )}
                          </tbody>
                      </table>
                  </div>
              </Card>
          </div>
      );
  };

  const InvoicesView = () => (
      <div className="flex flex-col lg:flex-row gap-8 relative items-start h-full">
          <div className="w-full lg:w-[380px] xl:w-[420px] flex-shrink-0 lg:sticky lg:top-0 transition-all z-20">
              <InvoiceForm 
                onAdd={handleAddInvoice} 
                currentStock={currentStock} 
                lockDate={lockDate} 
                invoices={invoices}
                isWorkingMode={isWorkingMode} 
                setIsWorkingMode={setIsWorkingMode}
              />
          </div>
          <div className="flex-1 w-full min-w-0">
              <Card title="Recent Transactions" className="min-h-[600px] h-full flex flex-col" delay={200}
                 action={
                     <div className="flex gap-3 items-center">
                        <ExportMenu onExport={(t) => initiateExport(handleInvoicesExport, t)} />
                        {renderDateFilter()}
                     </div>
                 }
              >
                  <div className="overflow-auto flex-1 -mx-6 px-6 relative custom-scrollbar">
                      <table className="w-full text-sm text-left border-separate border-spacing-y-2 min-w-[1000px]">
                          <thead className="text-slate-400 sticky top-0 bg-white/95 backdrop-blur z-10">
                              <tr>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50">Date</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50">Type</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50">Party</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">Qty</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">Rate/g</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">My Cost/g</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">Taxable</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">GST</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">Total</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">Cost</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-right">Profit</th>
                                  <th className="px-4 py-3 font-bold uppercase text-[10px] tracking-wider border-b border-slate-50 text-center">Action</th>
                              </tr>
                          </thead>
                          <tbody>
                              {filteredInvoices.length === 0 ? (
                                  <tr><td colSpan={12} className="px-4 py-20 text-center text-slate-400 italic">No transactions recorded in this period.</td></tr>
                              ) : (
                                  filteredInvoices.sort((a,b) => b.date.localeCompare(a.date)).map((inv, i) => {
                                      const myCostPerGram = inv.type === 'SALE' && inv.cogs ? inv.cogs / inv.quantityGrams : null;
                                      return (
                                      <tr key={inv.id} className="group hover:bg-slate-50 transition-colors">
                                          <td className="px-4 py-3 bg-white border-y border-l border-slate-100 rounded-l-xl text-slate-500 font-mono text-xs">{inv.date}</td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100">
                                              <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border ${inv.type === 'PURCHASE' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-green-50 text-green-600 border-green-100'}`}>{inv.type === 'PURCHASE' ? 'In' : 'Out'}</span>
                                          </td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-medium text-slate-900 truncate max-w-[150px]">
                                              <div className="flex items-center justify-between gap-2 group/edit">
                                                  <span className="truncate">{inv.partyName}</span>
                                                  <button 
                                                    onClick={() => handleInitEditName(inv.id, inv.partyName)}
                                                    className="opacity-0 group-hover/edit:opacity-100 p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all"
                                                    title="Edit Name"
                                                  >
                                                      <Edit2 className="w-3 h-3"/>
                                                  </button>
                                              </div>
                                          </td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono text-slate-700 text-right font-bold">{formatGrams(inv.quantityGrams)}</td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono text-slate-500 text-right text-xs">{formatCurrency(inv.ratePerGram).replace('.00','')}</td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono text-slate-400 text-right text-xs">
                                              {myCostPerGram ? formatCurrency(myCostPerGram).replace('.00','') : '-'}
                                          </td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono font-medium text-slate-900 text-right">{formatCurrency(inv.taxableAmount)}</td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono text-slate-400 text-right text-xs">{formatCurrency(inv.gstAmount)}</td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono text-slate-500 text-right text-xs">{formatCurrency(inv.totalAmount)}</td>
                                          <td className="px-4 py-3 bg-white border-y border-slate-100 font-mono font-medium text-slate-500 text-right text-xs">
                                              {formatCurrency(inv.type === 'SALE' ? (inv.cogs || 0) : inv.taxableAmount)}
                                          </td>
                                          
                                          {/* PROFIT CELL WITH AUDIT TOOLTIP */}
                                          <td className={`px-4 py-3 bg-white border-y border-slate-100 font-mono font-bold text-right relative group/tooltip ${(inv.profit || 0) > 0 ? 'text-green-600' : (inv.profit || 0) < 0 ? 'text-red-600' : 'text-slate-300'}`}>
                                              {inv.type === 'SALE' ? (
                                                  <>
                                                      {formatCurrency(inv.profit || 0)}
                                                      {inv.fifoLog && inv.fifoLog.length > 0 && (
                                                          <div className="absolute right-0 bottom-full mb-2 w-64 bg-slate-900 text-white text-[10px] p-4 rounded-xl shadow-xl z-20 hidden group-hover/tooltip:block pointer-events-none border border-slate-800">
                                                              <p className="font-bold text-gold-400 mb-2 border-b border-slate-700 pb-1 uppercase tracking-wide">FIFO Consumption Log</p>
                                                              <ul className="space-y-1.5 opacity-90 font-mono text-xs">
                                                                  {inv.fifoLog.map((log, idx) => (
                                                                      <li key={idx} className="flex items-start gap-1"><span className="text-slate-500 mt-0.5">•</span> {log}</li>
                                                                  ))}
                                                              </ul>
                                                          </div>
                                                      )}
                                                  </>
                                              ) : '-'}
                                          </td>

                                          <td className="px-4 py-3 bg-white border-y border-r border-slate-100 rounded-r-xl text-center">
                                              <button onClick={() => initiateDelete(inv.id)} className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                                                  <Trash2 className="w-3.5 h-3.5"/>
                                              </button>
                                          </td>
                                      </tr>
                                  )})
                              )}
                          </tbody>
                      </table>
                  </div>
              </Card>
          </div>
      </div>
  );

  if (!session) {
    return <Auth />;
  }

  return (
    <Layout 
      activeTab={activeTab} 
      onTabChange={setActiveTab} 
      searchQuery={searchQuery} 
      onSearch={setSearchQuery}
      onLogout={handleLogout}
    >
        <Toast toasts={toasts} removeToast={removeToast} />
        
        {/* Sync Indicator */}
        {isSyncing && (
             <div className="fixed bottom-6 left-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-2xl shadow-slate-900/30 animate-slide-up border border-slate-800">
                 <Loader2 className="w-4 h-4 animate-spin text-gold-500" />
                 <span className="text-xs font-bold uppercase tracking-wider">Syncing data...</span>
             </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
                 <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-slide-up border border-slate-100">
                      <div className="flex flex-col items-center text-center gap-3 mb-6">
                           <div className="p-4 bg-red-50 text-red-600 rounded-full border border-red-100"><Trash2 className="w-6 h-6"/></div>
                           <div>
                               <h3 className="text-lg font-bold text-slate-900">Confirm Deletion</h3>
                               <p className="text-sm text-slate-500 mt-1">This action cannot be undone.</p>
                           </div>
                      </div>
                      <input 
                          type="password" 
                          placeholder="Enter Admin Password" 
                          value={deletePassword} 
                          onChange={(e) => setDeletePassword(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-center font-bold outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                          autoFocus
                      />
                      <div className="flex gap-3">
                          <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
                          <button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-500/20">Delete</button>
                      </div>
                 </div>
            </div>
        )}

        {/* Edit Name Modal */}
        {showEditNameModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
                 <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-slide-up border border-slate-100">
                      <div className="flex flex-col items-center text-center gap-3 mb-6">
                           <div className="p-4 bg-blue-50 text-blue-600 rounded-full border border-blue-100"><Edit2 className="w-6 h-6"/></div>
                           <div>
                               <h3 className="text-lg font-bold text-slate-900">Edit Party Name</h3>
                               <p className="text-sm text-slate-500 mt-1">Update record details safely.</p>
                           </div>
                      </div>
                      <div className="space-y-4 mb-6">
                          <input 
                              type="text" 
                              placeholder="New Party Name" 
                              value={newPartyName} 
                              onChange={(e) => setNewPartyName(e.target.value)}
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          />
                          <input 
                              type="password" 
                              placeholder="Admin Password" 
                              value={editNamePassword} 
                              onChange={(e) => setEditNamePassword(e.target.value)}
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-center outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          />
                      </div>
                      <div className="flex gap-3">
                          <button onClick={() => setShowEditNameModal(false)} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
                          <button onClick={confirmNameUpdate} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20">Update</button>
                      </div>
                 </div>
            </div>
        )}

        {/* Export Password Modal */}
        {showExportModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
                 <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-slide-up border border-slate-100">
                      <div className="flex flex-col items-center text-center gap-3 mb-6">
                           <div className="p-4 bg-gold-50 text-gold-600 rounded-full border border-gold-100"><Lock className="w-6 h-6"/></div>
                           <div>
                               <h3 className="text-lg font-bold text-slate-900">Secure Export</h3>
                               <p className="text-sm text-slate-500 mt-1">Management password required.</p>
                           </div>
                      </div>
                      <input 
                          type="password" 
                          placeholder="Password" 
                          value={exportPassword} 
                          onChange={(e) => setExportPassword(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-center font-bold outline-none focus:ring-2 focus:ring-gold-500/20 focus:border-gold-500 transition-all"
                          autoFocus
                      />
                      <div className="flex gap-3">
                          <button onClick={() => { setShowExportModal(false); setPendingExport(null); }} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
                          <button onClick={confirmExport} className="flex-1 py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-lg">Verify</button>
                      </div>
                 </div>
            </div>
        )}

        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'invoices' && <InvoicesView />}
        {activeTab === 'inventory' && (
             <div className="space-y-8 animate-enter">
                <SectionHeader title="Inventory Management" subtitle="Track stock levels and valuations." action={<div className="flex gap-3 items-center"><ExportMenu onExport={(t) => initiateExport(handleInventoryExport, t)} />{renderDateFilter()}</div>}/>
                <InventoryTable batches={filteredInventory} />
             </div>
        )}
        {activeTab === 'analytics' && <AnalyticsView />}
        {activeTab === 'customer-insights' && <CustomerInsightsView />}
        {activeTab === 'supplier-insights' && <SupplierInsightsView />}
        {activeTab === 'business-ledger' && <BusinessLedgerView />}
        {activeTab === 'price-analysis' && <PriceAnalysisView />}
    </Layout>
  );
}

export default App;
