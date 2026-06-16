import React, { useState } from 'react';
import { Mail, Zap } from 'lucide-react';
import NewsletterView from './NewsletterView';
import AutomationsView from './AutomationsView';

type Tab = 'newsletter' | 'automations';

export default function EmailDispatchView() {
  const [tab, setTab] = useState<Tab>('newsletter');

  return (
    <div className="-mx-8 -my-8 flex flex-col h-[calc(100vh-104px)]">
      {/* Sub-fliknavigation */}
      <div className="px-8 py-4 border-b border-gray-100 bg-white/60 backdrop-blur sticky top-0 z-10">
        <div className="inline-flex bg-gray-100 rounded-xl p-1 text-sm">
          {[
            { id: 'newsletter' as Tab, label: 'Nyhetsbrev', icon: Mail },
            { id: 'automations' as Tab, label: 'Automationer', icon: Zap },
          ].map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 ' +
                  (isActive
                    ? 'bg-white text-brand-dark shadow-sm'
                    : 'text-brand-muted hover:text-brand-dark')
                }
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Innehåll */}
      <div className="flex-1 overflow-auto">
        {tab === 'newsletter' && <NewsletterView />}
        {tab === 'automations' && <AutomationsView />}
      </div>
    </div>
  );
}
