import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, BookOpen, Sparkles, ShieldCheck, Zap, Brain } from 'lucide-react';

const Stat = ({ icon: Icon, title, desc }) => (
    <div className="glass-card p-5 w-full">
        <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center">
                <Icon size={18} className="text-blue-300/90" />
            </div>
            <div className="space-y-1">
                <div className="text-white font-black">{title}</div>
                <div className="text-slate-300/80 text-sm leading-relaxed">{desc}</div>
            </div>
        </div>
    </div>
);

export default function Home() {
    return (
        <div className="space-y-8">
            <div className="glass-card p-8 md:p-12 relative overflow-hidden">
                <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-purple-500/10 blur-3xl" />

                <div className="relative z-10 space-y-6 text-center">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5"
                    >
                        <Sparkles size={16} className="text-blue-300" />
                        <span className="text-slate-200/90 text-sm font-bold">Dark Black • Glass • شبكة أسئلة</span>
                    </motion.div>

                    <h1 className="text-4xl md:text-6xl font-black shimmer-text tracking-tight">
                        محقق اللاعبين
                    </h1>

                    <p className="text-slate-200/80 max-w-2xl mx-auto leading-relaxed font-medium">
                        فكر في لاعب كرة قدم، والذكاء الاصطناعي سيحاصره بأسئلة احترافية بدون تكرار
                        <br />
                        حتى يصل للاسم النهائي خلال 15 خطوة.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                        <Link
                            to="/play"
                            className="glass-button w-full sm:w-auto px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 border-blue-400/30 bg-gradient-to-r from-blue-600/40 to-blue-500/30"
                        >
                            <Play size={20} />
                            ابدأ اللعب
                        </Link>
                        <Link
                            to="/how-to"
                            className="glass-button w-full sm:w-auto px-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 border-white/10 bg-white/5"
                        >
                            <BookOpen size={20} />
                            طريقة اللعب
                        </Link>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
                <Stat
                    icon={Brain}
                    title="أسئلة احترافية"
                    desc="مصطلحات تكتيكية دقيقة بدل أسئلة تخمينية."
                />
                <Stat
                    icon={ShieldCheck}
                    title="بدون تكرار"
                    desc="فلترة تشابه تمنع نفس السؤال ومعناه."
                />
                <Stat
                    icon={Zap}
                    title="أسرع مع Supabase"
                    desc="لو السؤال موجود بالشبكة يرجع فوراً بدون AI."
                />
            </div>
        </div>
    );
}

