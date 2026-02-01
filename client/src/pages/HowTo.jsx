import { motion } from 'framer-motion';
import { Brain, HelpCircle, Database, Image, CheckCircle2 } from 'lucide-react';

const Step = ({ icon: Icon, title, children }) => (
    <div className="glass-card p-6">
        <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <Icon size={20} className="text-blue-300/90" />
            </div>
            <div className="space-y-2">
                <div className="text-white font-black text-lg">{title}</div>
                <div className="text-slate-200/75 text-sm leading-relaxed">{children}</div>
            </div>
        </div>
    </div>
);

export default function HowTo() {
    return (
        <div className="space-y-6">
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="glass-card p-8 md:p-10"
            >
                <div className="text-center space-y-3">
                    <div className="text-3xl md:text-4xl font-black shimmer-text">طريقة اللعب</div>
                    <div className="text-slate-200/75 leading-relaxed max-w-2xl mx-auto">
                        الهدف: الوصول لهوية اللاعب بأسئلة عالية الدقة، بدون تكرار، خلال 15 خطوة.
                    </div>
                </div>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-4">
                <Step icon={HelpCircle} title="1) فكر في لاعب">
                    اختر لاعب كرة قدم معروف. لا تخبر الموقع بالاسم.
                </Step>
                <Step icon={Brain} title="2) أجب بدقة">
                    استخدم: نعم / لا / لا أعرف / ربما. كل إجابة تقفل مسارات وتفتح مسارات.
                </Step>
                <Step icon={Database} title="3) لماذا اللعبة أسرع؟">
                    السيرفر يحاول أولاً استخراج السؤال التالي من Supabase (شبكة أسئلة).
                    إذا وجد انتقال مناسب، لن يتم استدعاء الذكاء الاصطناعي.
                </Step>
                <Step icon={CheckCircle2} title="4) تأكيد التخمين">
                    عند ظهور اسم اللاعب، سيتم سؤالك: هل التخمين صحيح؟
                    إذا كان صحيحاً، يتم حفظ “بروفايل” ومسار الأسئلة لتحسين اللعبة.
                </Step>
                <Step icon={Image} title="5) صورة اللاعب">
                    بعد التخمين يتم جلب صورة اللاعب من الإنترنت وعرضها فوراً.
                </Step>
            </div>
        </div>
    );
}

