import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Tag, Sparkles, Bug, CalendarDays, History } from 'lucide-react';
import LoadingState from '../components/LoadingState';
import { fetchChangelog } from '../lib/api';

function safeArray(value) {
    if (Array.isArray(value)) return value;
    return [];
}

function formatDate(input) {
    const date = input ? new Date(input) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function typeMeta(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'MAJOR_VERSION') {
        return {
            label: 'إصدار جديد',
            badge: 'from-purple-500/25 to-fuchsia-500/10 border-purple-400/30 text-purple-200',
            dot: 'bg-purple-400',
        };
    }
    if (t === 'HOTFIX') {
        return {
            label: 'إصلاح عاجل',
            badge: 'from-amber-500/25 to-orange-500/10 border-amber-400/30 text-amber-200',
            dot: 'bg-amber-400',
        };
    }
    return {
        label: 'تحديث جديد',
        badge: 'from-blue-500/25 to-cyan-500/10 border-blue-400/30 text-blue-200',
        dot: 'bg-blue-400',
    };
}

export default function Changelog() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);

        fetchChangelog()
            .then((data) => {
                if (!alive) return;
                setItems(Array.isArray(data) ? data : []);
            })
            .catch(() => {
                if (!alive) return;
                setError('تعذّر تحميل سجل التحديثات.');
            })
            .finally(() => {
                if (!alive) return;
                setLoading(false);
            });

        return () => {
            alive = false;
        };
    }, []);

    const timeline = useMemo(() => {
        return safeArray(items).map((item) => {
            const meta = typeMeta(item?.update_type);
            return {
                ...item,
                _meta: meta,
                _date: formatDate(item?.release_date),
                _features: safeArray(item?.features),
                _fixes: safeArray(item?.fixes),
            };
        });
    }, [items]);

    if (loading) return <LoadingState />;

    return (
        <div className="w-full">
            <div className="glass-card px-6 py-6 gradient-border">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/20 border border-white/10 backdrop-blur-sm flex items-center justify-center">
                                <History size={18} className="text-blue-300" />
                            </div>
                            <div>
                                <div className="text-white font-black tracking-tight text-xl">سجل التحديثات</div>
                                <div className="text-slate-300/80 text-sm font-medium">آخر التحسينات والميزات بشكل مبسط</div>
                            </div>
                        </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300/70">
                        <CalendarDays size={14} className="opacity-80" />
                        <span>مرتّب حسب الأحدث</span>
                    </div>
                </div>
            </div>

            {error ? (
                <div className="mt-6 glass-card px-6 py-5 border border-red-500/20">
                    <div className="text-red-200 font-bold">{error}</div>
                    <div className="text-slate-300/70 text-sm mt-1">حاول تحديث الصفحة أو التحقق من اتصال الخادم.</div>
                </div>
            ) : null}

            <div className="mt-6 relative">
                <div className="absolute right-5 top-0 bottom-0 w-px bg-white/10" />

                <div className="space-y-5">
                    {timeline.map((item, index) => (
                        <motion.div
                            key={item?.id || `${item?.version}-${index}`}
                            initial={{ opacity: 0, y: 18 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.45, ease: 'easeOut', delay: index * 0.05 }}
                            className="relative pr-12"
                        >
                            <div className={`absolute right-[14px] top-7 w-3 h-3 rounded-full ${item?._meta?.dot || 'bg-blue-400'} shadow-lg`} />

                            <div className="glass-card px-6 py-5">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`px-3 py-1 rounded-full text-xs font-black border bg-gradient-to-br ${item?._meta?.badge || ''}`}>
                                            {item?._meta?.label || 'تحديث'}
                                        </div>
                                        <div className="text-white font-black tracking-tight flex items-center gap-2">
                                            <Tag size={16} className="opacity-80" />
                                            <span>{item?.version || 'v0.0.0'}</span>
                                        </div>
                                    </div>
                                    <div className="text-slate-300/70 text-xs flex items-center gap-2">
                                        <CalendarDays size={14} className="opacity-80" />
                                        <span>{item?._date || ''}</span>
                                    </div>
                                </div>

                                <div className="mt-4 text-slate-100/90 text-sm leading-relaxed">
                                    {item?.summary || '—'}
                                </div>

                                <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-slate-200 font-black">
                                            <Sparkles size={16} className="text-cyan-300" />
                                            <span>ميزات جديدة</span>
                                        </div>
                                        {item?._features?.length ? (
                                            <ul className="space-y-1 text-sm text-slate-200/85">
                                                {item._features.map((f, i) => (
                                                    <li key={`${item?.id}-f-${i}`} className="flex items-start gap-2">
                                                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-cyan-300/80" />
                                                        <span>{String(f)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="text-slate-300/60 text-sm">لا توجد ميزات جديدة في هذا التحديث.</div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-slate-200 font-black">
                                            <Bug size={16} className="text-amber-300" />
                                            <span>إصلاحات</span>
                                        </div>
                                        {item?._fixes?.length ? (
                                            <ul className="space-y-1 text-sm text-slate-200/85">
                                                {item._fixes.map((f, i) => (
                                                    <li key={`${item?.id}-x-${i}`} className="flex items-start gap-2">
                                                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-amber-300/80" />
                                                        <span>{String(f)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="text-slate-300/60 text-sm">لا توجد إصلاحات مُسجّلة في هذا التحديث.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}

                    {timeline.length === 0 && !error ? (
                        <div className="glass-card px-6 py-6 text-slate-200/80">
                            لا توجد تحديثات منشورة بعد.
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

