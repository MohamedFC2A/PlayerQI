import { motion } from 'framer-motion';
import { Play, Sparkles } from 'lucide-react';

export default function GameStart({ onStart }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-10 relative z-10">
            {/* Decorative floating elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <motion.div
                    animate={{
                        y: [0, -20, 0],
                        x: [0, 10, 0],
                        scale: [1, 1.1, 1]
                    }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-10 left-10 w-24 h-24 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/10 blur-xl"
                />
                <motion.div
                    animate={{
                        y: [0, 15, 0],
                        x: [0, -15, 0],
                        scale: [1, 0.9, 1]
                    }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="absolute bottom-20 right-10 w-32 h-32 rounded-full bg-gradient-to-br from-cyan-500/15 to-blue-500/10 blur-xl"
                />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="space-y-6"
            >
                {/* Icon */}
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                    className="flex justify-center"
                >
                    <div className="p-4 bg-gradient-to-br from-blue-500/30 to-purple-500/20 rounded-2xl backdrop-blur-sm border border-white/10 glow-blue">
                        <Sparkles size={48} className="text-blue-400" />
                    </div>
                </motion.div>

                {/* Title */}
                <h1 className="text-5xl md:text-6xl font-black shimmer-text tracking-tight">
                    محقق اللاعبين
                </h1>

                {/* Subtitle */}
                <p className="text-lg md:text-xl text-slate-300/90 max-w-lg mx-auto leading-relaxed font-medium">
                    فكر في لاعب كرة قدم، وسيقوم الذكاء الاصطناعي بتخمينه
                    <br />
                    <span className="text-blue-400">من خلال 15 سؤالاً ذكياً!</span>
                </p>
            </motion.div>

            {/* Start Button */}
            <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onStart}
                className="glass-button px-12 py-5 text-xl font-bold rounded-2xl flex items-center gap-4 shadow-2xl group text-white celebration-glow"
            >
                <motion.div
                    animate={{ rotate: [0, 360] }}
                    transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    className="bg-gradient-to-br from-blue-500 to-blue-600 p-3 rounded-xl group-hover:from-blue-400 group-hover:to-blue-500 transition-all shadow-lg"
                >
                    <Play size={24} fill="currentColor" />
                </motion.div>
                <span className="relative">
                    ابدأ التحدي
                    <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-50"></span>
                </span>
            </motion.button>

            {/* Footer hint */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                className="text-slate-500 text-sm mt-8"
            >
                هل أنت مستعد للتحدي؟ 🏆
            </motion.p>
        </div>
    );
}
