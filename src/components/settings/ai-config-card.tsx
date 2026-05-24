'use client';

import { useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import type { AppConfig } from '@/types';

interface AIConfigCardProps {
  config: AppConfig | null;
  saveConfig: (key: string, value: string, setter: (v: boolean) => void) => Promise<void>;
  fetchConfig: () => Promise<void>;
}

export function AIConfigCard({ config, saveConfig, fetchConfig }: AIConfigCardProps) {
  const [aiProviderValue, setAiProviderValue] = useState<'z-ai' | 'openai-compatible'>('z-ai');
  const [aiModelValue, setAiModelValue] = useState('');
  const [aiApiKeyValue, setAiApiKeyValue] = useState('');
  const [aiBaseUrlValue, setAiBaseUrlValue] = useState('https://api.oencode.com/v1');
  const [aiTemperatureValue, setAiTemperatureValue] = useState(0.3);
  const [aiMaxStepsValue, setAiMaxStepsValue] = useState(5);
  const [savingAiProvider, setSavingAiProvider] = useState(false);
  const [savingAiModel, setSavingAiModel] = useState(false);
  const [savingAiApiKey, setSavingAiApiKey] = useState(false);
  const [savingAiBaseUrl, setSavingAiBaseUrl] = useState(false);
  const [savingAiTemperature, setSavingAiTemperature] = useState(false);
  const [savingAiMaxSteps, setSavingAiMaxSteps] = useState(false);

  const [prevConfig, setPrevConfig] = useState<AppConfig | null>(null);
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config?.config.ai_provider) setAiProviderValue(config.config.ai_provider as 'z-ai' | 'openai-compatible');
    if (config?.config.ai_model) setAiModelValue(config.config.ai_model);
    if (config?.config.ai_api_key) setAiApiKeyValue(config.config.ai_api_key);
    if (config?.config.ai_base_url) setAiBaseUrlValue(config.config.ai_base_url);
    if (config?.config.ai_temperature) setAiTemperatureValue(parseFloat(config.config.ai_temperature));
    if (config?.config.ai_max_steps) setAiMaxStepsValue(parseInt(config.config.ai_max_steps, 10));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          AI Configuration
        </CardTitle>
        <CardDescription>
          Configure the AI provider and model used for code reviews
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider selector */}
        <div className="space-y-3">
          <Label>AI Provider</Label>
          <div className="flex gap-2">
            <Button
              variant={aiProviderValue === 'z-ai' ? 'default' : 'outline'}
              onClick={() => {
                setAiProviderValue('z-ai');
                saveConfig('ai_provider', 'z-ai', setSavingAiProvider);
              }}
              disabled={savingAiProvider}
              className="flex-1"
            >
              {savingAiProvider && aiProviderValue === 'z-ai' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Z-AI (Default)
            </Button>
            <Button
              variant={aiProviderValue === 'openai-compatible' ? 'default' : 'outline'}
              onClick={() => {
                setAiProviderValue('openai-compatible');
                saveConfig('ai_provider', 'openai-compatible', setSavingAiProvider);
              }}
              disabled={savingAiProvider}
              className="flex-1"
            >
              {savingAiProvider && aiProviderValue === 'openai-compatible' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              OpenAI-Compatible (Zen/Oencode)
            </Button>
          </div>
        </div>

        {/* Provider-specific fields */}
        {aiProviderValue === 'z-ai' ? (
          <div className="space-y-3">
            <Label>Model</Label>
            <div className="flex gap-2">
              <Button
                variant={!aiModelValue || aiModelValue === 'default' ? 'default' : 'outline'}
                onClick={() => {
                  setAiModelValue('default');
                  saveConfig('ai_model', 'default', setSavingAiModel);
                }}
                disabled={savingAiModel}
                className="flex-1"
              >
                Default
              </Button>
              <Button
                variant={aiModelValue === 'advanced' ? 'default' : 'outline'}
                onClick={() => {
                  setAiModelValue('advanced');
                  saveConfig('ai_model', 'advanced', setSavingAiModel);
                }}
                disabled={savingAiModel}
                className="flex-1"
              >
                Advanced
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Default uses a balanced model; Advanced uses a more capable model for complex reviews
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label htmlFor="ai-model-name">Model Name</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-model-name"
                  placeholder="e.g. gpt-4o, claude-3-opus"
                  value={aiModelValue}
                  onChange={(e) => setAiModelValue(e.target.value)}
                />
                <Button
                  onClick={() => saveConfig('ai_model', aiModelValue, setSavingAiModel)}
                  disabled={savingAiModel || !aiModelValue}
                >
                  {savingAiModel ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-api-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-api-key"
                  type="password"
                  placeholder={config?.hasAiProvider ? '•••••••• (already set)' : 'sk-xxxxxxxxxxxx'}
                  value={aiApiKeyValue}
                  onChange={(e) => setAiApiKeyValue(e.target.value)}
                />
                <Button
                  onClick={() => saveConfig('ai_api_key', aiApiKeyValue, setSavingAiApiKey)}
                  disabled={savingAiApiKey || !aiApiKeyValue}
                >
                  {savingAiApiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-base-url"
                  placeholder="https://api.oencode.com/v1"
                  value={aiBaseUrlValue}
                  onChange={(e) => setAiBaseUrlValue(e.target.value)}
                />
                <Button
                  onClick={() => saveConfig('ai_base_url', aiBaseUrlValue, setSavingAiBaseUrl)}
                  disabled={savingAiBaseUrl || !aiBaseUrlValue}
                >
                  {savingAiBaseUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Default: https://api.oencode.com/v1
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Temperature */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Temperature</Label>
            <span className="text-sm font-mono text-muted-foreground">{aiTemperatureValue.toFixed(1)}</span>
          </div>
          <Slider
            value={[aiTemperatureValue]}
            onValueChange={(v) => setAiTemperatureValue(v[0])}
            min={0}
            max={1}
            step={0.1}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Lower values are more focused and deterministic; higher values are more creative
          </p>
        </div>

        <Separator />

        {/* Max Agent Steps */}
        <div className="space-y-2">
          <Label htmlFor="ai-max-steps">Max Agent Steps</Label>
          <div className="flex gap-2 items-center">
            <Input
              id="ai-max-steps"
              type="number"
              min={1}
              max={10}
              value={aiMaxStepsValue}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1 && val <= 10) {
                  setAiMaxStepsValue(val);
                }
              }}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">(1–10)</span>
            <Button
              onClick={() => saveConfig('ai_max_steps', String(aiMaxStepsValue), setSavingAiMaxSteps)}
              disabled={savingAiMaxSteps}
              className="ml-auto"
            >
              {savingAiMaxSteps ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Maximum number of reasoning steps the AI agent can take per review
          </p>
        </div>

        <Separator />

        {/* Save AI Configuration */}
        <Button
          className="w-full"
          onClick={async () => {
            setSavingAiTemperature(true);
            try {
              await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'ai_temperature', value: String(aiTemperatureValue) }),
              });
              toast.success('AI Configuration saved');
              fetchConfig();
            } catch {
              toast.error('Failed to save AI configuration');
            } finally {
              setSavingAiTemperature(false);
            }
          }}
          disabled={savingAiTemperature}
        >
          {savingAiTemperature ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              Save AI Configuration
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
