'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle,
  ChevronRight,
  Eye,
  Wrench,
  Search,
  FileCode,
  Brain,
  Timer,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { AgentStepData } from '@/types';

// Step icon mapper
export function getStepIcon(step: string, tool?: string) {
  if (step === 'analyze') return <Eye className="h-4 w-4" />;
  if (step === 'tool_call') {
    if (tool === 'search_pattern') return <Search className="h-4 w-4" />;
    return <Wrench className="h-4 w-4" />;
  }
  if (step === 'reflect') return <CheckCircle className="h-4 w-4" />;
  if (step === 'review') return <FileCode className="h-4 w-4" />;
  if (step === 'synthesis') return <Brain className="h-4 w-4" />;
  return <ChevronRight className="h-4 w-4" />;
}

// Step color mapper
export function getStepColor(step: string) {
  if (step === 'analyze') return 'bg-violet-500';
  if (step === 'tool_call') return 'bg-amber-500';
  if (step === 'reflect') return 'bg-emerald-500';
  if (step === 'review') return 'bg-primary';
  if (step === 'synthesis') return 'bg-rose-500';
  return 'bg-muted-foreground';
}

// Reasoning Trace component
export function ReasoningTrace({ agentStepsJson, modelUsed, tokensUsed }: { agentStepsJson?: string; modelUsed?: string; tokensUsed?: number }) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!agentStepsJson) return null;

  let steps: AgentStepData[];
  try {
    steps = JSON.parse(agentStepsJson);
    if (!Array.isArray(steps) || steps.length === 0) return null;
  } catch {
    return null;
  }

  // Compute total duration
  const firstTs = steps[0]?.timestamp ? new Date(steps[0].timestamp).getTime() : null;
  const lastTs = steps[steps.length - 1]?.timestamp ? new Date(steps[steps.length - 1].timestamp).getTime() : null;
  const totalDurationMs = firstTs && lastTs ? lastTs - firstTs : null;
  const totalStepDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);

  return (
    <div className="space-y-3">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-500" />
            Reasoning Trace
          </h4>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="relative mt-3 ml-3">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />

            {steps.map((step, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08, duration: 0.3 }}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {/* Timeline dot */}
                <div className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full ${getStepColor(step.step)} text-white shrink-0 mt-0.5`}>
                  {getStepIcon(step.step, step.tool)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground">Step {idx + 1}</span>
                    <span className="text-sm font-medium">{step.description}</span>
                    {step.tool && (
                      <Badge variant="outline" className="text-xs font-mono h-5">
                        {step.tool}
                      </Badge>
                    )}
                    {step.durationMs != null && step.durationMs > 0 && (
                      <Badge variant="secondary" className="text-xs h-5 gap-1">
                        <Timer className="h-3 w-3" />
                        {step.durationMs >= 1000 ? `${(step.durationMs / 1000).toFixed(1)}s` : `${step.durationMs}ms`}
                      </Badge>
                    )}
                  </div>

                  {step.reasoning && (
                    <p className="text-xs text-muted-foreground italic pl-0">
                      💭 {step.reasoning}
                    </p>
                  )}

                  {step.conclusion && (
                    <div className="rounded-md bg-muted/60 border border-border/50 px-3 py-1.5 text-xs text-foreground/80">
                      {step.conclusion}
                    </div>
                  )}

                  {step.evidence && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="link" size="sm" className="h-5 px-0 text-xs text-muted-foreground">
                          View evidence
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <pre className="text-xs bg-muted rounded-md p-2 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                          {step.evidence}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Model Info Card */}
          <div className="mt-4 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-violet-500" />
              <span className="text-xs font-semibold">Model Info</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Model</span>
                <p className="font-medium font-mono">{modelUsed || '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Tokens</span>
                <p className="font-medium">{tokensUsed != null ? `~${tokensUsed.toLocaleString()}` : '—'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Steps</span>
                <p className="font-medium">{steps.length}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Duration</span>
                <p className="font-medium">
                  {totalDurationMs != null
                    ? totalDurationMs >= 1000
                      ? `${(totalDurationMs / 1000).toFixed(1)}s`
                      : `${totalDurationMs}ms`
                    : totalStepDuration > 0
                      ? totalStepDuration >= 1000
                        ? `${(totalStepDuration / 1000).toFixed(1)}s`
                        : `${totalStepDuration}ms`
                      : '—'}
                </p>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
