import { action, page, state, type ActionInput, type LivePageConnectionContext } from 'redweb';
import { z } from 'zod';

const input = z.object({ amount: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(1000)) }).strict();

@page('/', { shared: true })
export class ValidatedPage {
    @state() total = 0;

    @action({ input, authorize: (context, value) => context.principal === 'trusted-owner' && value.amount <= 10 })
    save(value: ActionInput<typeof input>, context: LivePageConnectionContext) {
        this.total += value.amount;
        return { total: this.total, principal: context.principal };
    }

    @action({ authorize: context => context.principal === 'trusted-owner' })
    who(_input: unknown, context: LivePageConnectionContext) { return context.principal; }

    render() { return '<p>Validated TypeScript consumer</p>'; }
}
