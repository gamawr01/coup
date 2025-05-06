
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { BookOpen, Coins, Swords } from 'lucide-react';
import { cardInfo } from '@/lib/card-definitions'; // Import cardInfo

interface ActionDetail {
  name: string;
  icon: React.ReactNode;
  description: string;
  cost?: number;
  blockableBy?: string;
}

const generalActions: ActionDetail[] = [
  { name: 'Renda', icon: <Coins className="w-5 h-5 text-yellow-500" />, description: 'Pegue 1 moeda do Tesouro.', cost: 0, blockableBy: 'Ninguém (Incontestável, Imbloqueável)' },
  { name: 'Ajuda Externa', icon: <Coins className="w-5 h-5 text-yellow-400" />, description: 'Pegue 2 moedas do Tesouro.', cost: 0, blockableBy: 'Duque' },
  { name: 'Golpe de Estado', icon: <Swords className="w-5 h-5 text-red-600" />, description: 'Pague 7 moedas. Escolha um jogador para perder 1 influência.', cost: 7, blockableBy: 'Ninguém (Incontestável, Imbloqueável)' },
];

const characterActionsList: ActionDetail[] = [
  { name: 'Duque - Taxar', icon: cardInfo.Duke.icon, description: 'Pegue 3 moedas do Tesouro.', cost: 0, blockableBy: 'Ninguém (Ação não bloqueável)' },
  { name: 'Assassino - Assassinar', icon: cardInfo.Assassin.icon, description: 'Pague 3 moedas. Escolha um jogador para perder 1 influência.', cost: 3, blockableBy: 'Condessa' },
  { name: 'Capitão - Extorquir', icon: cardInfo.Captain.icon, description: 'Pegue 2 moedas de outro jogador.', cost: 0, blockableBy: 'Capitão ou Embaixador' },
  { name: 'Embaixador - Trocar', icon: cardInfo.Ambassador.icon, description: 'Compre 2 cartas do Baralho da Corte, devolva 2 ao baralho.', cost: 0, blockableBy: 'Ninguém (Ação não bloqueável)' },
];

const counterActionsList: ActionDetail[] = [
  { name: 'Duque - Bloqueia Ajuda Externa', icon: cardInfo.Duke.icon, description: 'Impede um jogador de receber Ajuda Externa.' },
  { name: 'Condessa - Bloqueia Assassinato', icon: cardInfo.Contessa.icon, description: 'Impede uma tentativa de Assassinato contra você.' },
  { name: 'Capitão / Embaixador - Bloqueia Extorsão', icon: <div className="flex gap-1">{React.cloneElement(cardInfo.Captain.icon as React.ReactElement, {className: "w-5 h-5"})}{React.cloneElement(cardInfo.Ambassador.icon as React.ReactElement, {className: "w-5 h-5"})}</div>, description: 'Impede uma tentativa de Extorsão contra você.' },
];


export const ActionSummaryDialog: React.FC = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="fixed top-4 right-4 z-20 rounded-full w-12 h-12 shadow-lg bg-card hover:bg-card/90 border-border">
          <BookOpen className="h-6 w-6 text-primary" />
          <span className="sr-only">Resumo das Ações</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto bg-background text-foreground p-6 rounded-lg shadow-xl border-border">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-2xl font-bold text-primary">Resumo das Ações</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Consulte as ações disponíveis, seus custos, e quem pode bloqueá-las ou contestá-las.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-2">
          <div>
            <h3 className="text-xl font-semibold mb-3 text-accent">Ações Gerais</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {generalActions.map((action) => (
                <div key={action.name} className="p-4 border border-border rounded-lg bg-card flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
                   <div className="flex-shrink-0 mt-1">{action.icon}</div>
                   <div>
                     <p className="font-semibold text-card-foreground">{action.name} {action.cost ? <span className="text-xs text-muted-foreground">(-{action.cost} moedas)</span> : ''}</p>
                     <p className="text-sm text-muted-foreground">{action.description}</p>
                     <p className="text-xs text-muted-foreground mt-1">Bloqueável por: {action.blockableBy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xl font-semibold mb-3 text-accent">Ações de Personagem</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {characterActionsList.map((action) => (
                   <div key={action.name} className="p-4 border border-border rounded-lg bg-card flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
                     <div className="flex-shrink-0 mt-1">{React.cloneElement(action.icon as React.ReactElement, { className: "w-5 h-5" })}</div>
                     <div>
                       <p className="font-semibold text-card-foreground">{action.name} {action.cost ? <span className="text-xs text-muted-foreground">(-{action.cost} moedas)</span> : ''}</p>
                       <p className="text-sm text-muted-foreground">{action.description}</p>
                       <p className="text-xs text-muted-foreground mt-1">Bloqueável por: {action.blockableBy}</p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
           <div>
            <h3 className="text-xl font-semibold mb-3 text-accent">Ações Contrárias (Bloqueios)</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {counterActionsList.map((action) => (
                 <div key={action.name} className="p-4 border border-border rounded-lg bg-card flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex-shrink-0 mt-1">{action.icon}</div>
                   <div>
                     <p className="font-semibold text-card-foreground">{action.name}</p>
                     <p className="text-sm text-muted-foreground">{action.description}</p>
                  </div>
                </div>
               ))}
            </div>
          </div>

           <div className="p-4 border border-border rounded-lg bg-card shadow-sm">
             <h3 className="text-xl font-semibold mb-2 text-accent">Contestações</h3>
             <p className="text-sm text-muted-foreground leading-relaxed">
                Qualquer Ação de Personagem ou Ação Contrária (Bloqueio) pode ser contestada por qualquer outro jogador.
                Se contestado, o jogador deve provar que possui a influência necessária revelando a carta correspondente.
             </p>
             <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                <li><span className="font-semibold text-card-foreground">Se não puder provar (blefou):</span> Perde a contestação e 1 influência imediatamente. A ação/bloqueio blefado falha. Custo da ação original (se houver) é perdido (ex: Assassinar).</li>
                <li><span className="font-semibold text-card-foreground">Se puder provar:</span> O contestador perde 1 influência imediatamente. O jogador contestado embaralha a carta revelada de volta no Baralho e compra 1 nova carta oculta. A ação/bloqueio original prossegue.</li>
             </ul>
             <p className="text-sm text-destructive mt-2 font-medium">
                Atenção ao Perigo do Assassinato Duplo: Perder uma contestação ao ser alvo de Assassinato OU ao blefar Condessa para bloquear um Assassinato resulta na perda de DUAS influências.
             </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
