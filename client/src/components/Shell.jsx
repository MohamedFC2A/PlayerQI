import { NavLink, Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Play, BookOpen, History } from 'lucide-react';

const navItems = [
    { to: '/', label: 'الرئيسية', icon: Sparkles },
    { to: '/play', label: 'العب الآن', icon: Play },
    { to: '/how-to', label: 'طريقة اللعب', icon: BookOpen },
    { to: '/changelog', label: 'التحديثات', icon: History },
];

export default function Shell() {
    return (
        <div className="min-h-screen w-full relative">
            <div className="w-full max-w-6xl mx-auto px-4 py-6 relative z-10">
                <div className="w-full glass-card px-5 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/20 border border-white/10 backdrop-blur-sm flex items-center justify-center">
                            <Sparkles size={20} className="text-blue-300" />
                        </div>
                        <div className="leading-tight">
                            <div className="text-white font-black tracking-tight text-lg">محقق اللاعبين</div>
                            <div className="text-slate-300/80 text-xs font-medium">شبكة أسئلة ذكية + تخمين احترافي</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            return (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    className={({ isActive }) => `
                                        glass-button px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2
                                        border ${isActive ? 'border-blue-400/40 bg-white/10' : 'border-white/10'}
                                    `}
                                >
                                    <Icon size={16} className="opacity-80" />
                                    <span className="hidden sm:inline">{item.label}</span>
                                </NavLink>
                            );
                        })}
                    </div>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="pt-6"
                >
                    <Outlet />
                </motion.div>

                <div className="mt-8 text-center text-slate-400/70 text-xs">
                    PlayerQI • DeepSeek + Serper + Supabase Graph
                </div>
            </div>
        </div>
    );
}
