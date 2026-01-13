
import React from 'react';

interface StatsCardProps {
  title: string;
  value: string;
  subValue?: string;
  icon?: React.ElementType;
  delayIndex?: number;
  isActive?: boolean;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, subValue, icon: Icon, delayIndex = 0, isActive = false }) => {
  return (
    <div 
      className={`relative overflow-hidden rounded-2xl p-6 transition-all duration-500 group animate-slide-up
        ${isActive 
          ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/20 border border-slate-800' 
          : 'bg-white text-slate-900 shadow-[0_2px_12px_-4px_rgba(6,81,237,0.08)] border border-slate-100 hover:border-gold-200/50 hover:shadow-lg'
        }`}
      style={{ animationDelay: `${delayIndex * 75}ms` }}
    >
      {/* Background Decor */}
      {isActive ? (
        <>
            <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/10 rounded-full blur-3xl -mr-10 -mt-10 animate-pulse-slow"></div>
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -ml-8 -mb-8"></div>
        </>
      ) : (
        <div className="absolute top-0 right-0 w-20 h-20 bg-slate-50/50 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none group-hover:bg-gold-50/50 transition-colors"></div>
      )}
      
      <div className="relative z-10 flex justify-between items-start">
        <div className="flex flex-col">
          <p className={`text-[11px] font-bold uppercase tracking-widest mb-3 ${isActive ? 'text-slate-400' : 'text-slate-400 group-hover:text-gold-600 transition-colors'}`}>
            {title}
          </p>
          <h3 className={`text-2xl lg:text-3xl font-mono font-bold tracking-tight leading-none mb-2 ${isActive ? 'text-white' : 'text-slate-900'}`}>
            {value}
          </h3>
          {subValue && (
            <p className={`text-[11px] font-medium flex items-center gap-1.5 ${isActive ? 'text-slate-400' : 'text-slate-500'}`}>
              {isActive && <span className="w-1 h-1 rounded-full bg-green-400 inline-block"></span>}
              {subValue}
            </p>
          )}
        </div>

        {Icon && (
          <div className={`p-3 rounded-xl transition-all duration-300 ${
            isActive 
              ? 'bg-white/10 text-gold-400 backdrop-blur-md' 
              : 'bg-slate-50 text-slate-400 group-hover:text-gold-600 group-hover:bg-gold-50'
          }`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
};

export default StatsCard;
