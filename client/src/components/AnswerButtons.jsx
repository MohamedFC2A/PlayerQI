import { motion } from 'framer-motion';
import { Check, X, HelpCircle, CircleDot } from 'lucide-react';

const answers = [
    {
        label: 'نعم',
        value: 'نعم',
        icon: Check,
        gradient: 'from-green-500/20 to-green-600/10',
        border: 'border-l-green-400',
        glow: 'group-hover:shadow-green-500/30'
    },
    {
        label: 'لا',
        value: 'لا',
        icon: X,
        gradient: 'from-red-500/20 to-red-600/10',
        border: 'border-l-red-400',
        glow: 'group-hover:shadow-red-500/30'
    },
    {
        label: 'لا أعرف',
        value: 'لا أعرف',
        icon: HelpCircle,
        gradient: 'from-slate-500/20 to-slate-600/10',
        border: 'border-l-slate-400',
        glow: 'group-hover:shadow-slate-500/30'
    },
    {
        label: 'ربما / جزئياً',
        value: 'ربما',
        icon: CircleDot,
        gradient: 'from-amber-500/20 to-amber-600/10',
        border: 'border-l-amber-400',
        glow: 'group-hover:shadow-amber-500/30'
    },
];

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.08
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.9 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring", stiffness: 300, damping: 20 }
    }
};

export default function AnswerButtons({ onAnswer, disabled }) {
    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-2 gap-4 w-full max-w-xl"
        >
            {answers.map((ans) => {
                const Icon = ans.icon;
                return (
                    <motion.button
                        key={ans.value}
                        variants={itemVariants}
                        whileHover={{ scale: 1.03, y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => onAnswer(ans.value)}
                        disabled={disabled}
                        className={`
                            glass-button group py-5 px-6 rounded-xl font-bold text-lg text-white 
                            disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none
                            border-l-4 ${ans.border}
                            bg-gradient-to-r ${ans.gradient}
                            transition-all duration-300
                            hover:shadow-xl ${ans.glow}
                        `}
                    >
                        <div className="flex items-center justify-center gap-3">
                            <motion.div
                                whileHover={{ rotate: [0, -10, 10, 0] }}
                                transition={{ duration: 0.4 }}
                            >
                                <Icon size={22} className="opacity-80" />
                            </motion.div>
                            <span>{ans.label}</span>
                        </div>
                    </motion.button>
                );
            })}
        </motion.div>
    );
}
