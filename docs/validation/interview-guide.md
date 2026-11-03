# Customer interviews: guide

Milestone M11-0. Before building anything for professionals, find out who has a problem Thread
already solves, how they solve it today, and whether they would pay. This is a working document:
no app code depends on it.

## What we are trying to learn

1. **Problem**: do they lose time finding, matching or describing fabrics, colours and pieces?
2. **Today**: what do they use now (phone gallery, WhatsApp, Instagram saved posts, Excel,
   Pinterest, paper swatch books), and what does that cost them?
3. **Fit**: which of Thread's existing features would they actually use? (See *What Thread can
   honestly show* below; nothing else.)
4. **Money**: would they pay, how much, and for what: software, or someone setting it up?

The hypothesis to test first: **textile-led boutiques and independent designers** have the
clearest need and willingness to pay. Stylists come second; students and researchers are for
reach, not revenue. Be ready to be wrong.

## Who to talk to

Aim for 15 conversations in three weeks, at least 3 from each of the first two groups.

| # | Category | Where to find them | Why they matter |
| --- | --- | --- | --- |
| 1 | Saree and handloom boutique owners | Instagram shops, local markets, exhibitions | Primary hypothesis: catalogue and colour matching |
| 2 | Independent ethnic-wear designers and small labels | Instagram, design fairs, pop-ups | Primary hypothesis: fabric library, palettes |
| 3 | Freelance personal stylists | Instagram, referrals | Client wardrobes; need sharing |
| 4 | Bridal and wedding stylists | Wedding planners, Instagram | High-value, colour-coordination heavy |
| 5 | Fashion design students and faculty | Design colleges, alumni groups | Reach, feedback, future professionals |
| 6 | Textile design students | Textile programmes, craft clubs | Pattern and weave research |
| 7 | Vintage saree and textile resellers, collectors | Instagram resale pages, collector groups | Cataloguing many unique pieces |
| 8 | Craft documentation NGOs, textile researchers | Craft councils, university departments | Archive and records use case |
| 9 | Costume designers (film, theatre) | Theatre groups, production networks | Mood boards and colour continuity |
| 10 | Weaver cooperatives' marketing teams | Cooperatives, handloom fairs | Catalogue for buyers |

Avoid filling the list with friends and family: they are kind, not customers. Note how you met
each person.

## Consent and privacy

Say this at the start, in your own words:

> "I'm building a tool for fashion and textiles and I'd like to understand how you work. It takes
> about 20 minutes. May I take written notes? I won't record, I won't share your name, and I'll
> delete my notes if you ask."

- Do not record audio or video unless they agree explicitly; written notes are enough.
- Do not photograph their stock or clients' clothes without permission.
- Store notes without surnames or phone numbers; use a code (B1, D2, S3...).
- Delete a person's notes when they ask.

## The conversation (about 20 minutes)

Ask about what they **did**, not what they **would do**. Don't pitch until the end.

**Their work (5 minutes)**

- Tell me about your work. What do you make, sell or style?
- How many pieces or fabrics do you deal with in a month?

**The last time (10 minutes)**

- Tell me about the last time you had to find a fabric or piece you already had. What happened?
- The last time a customer or client asked for "this, but in another colour"? How did you answer?
- How do you keep track of fabrics, colours and stock today? Can you show me?
- What's annoying about that? What have you tried to fix it? Did you pay for anything?
- How do you share a selection with a customer or client today?

**Thread (5 minutes, only now)**

Show the public demo (`/demo`) on your phone: a piece's palette, "same fabric, different
colour", a collection.

- Which part, if any, would you have used last week? For what?
- What's missing that would stop you using it?

**Commitment (the most important question)**

- "I'm running a small pilot: I set up your catalogue in Thread, up to about 100 pieces, organised
  into collections, with colour cards. It's ₹2,999 once *(test price)*. Would you like to be one
  of the first five?"
- If no: "What would it need to be worth that to you?"
- If maybe: "What would you need to see to decide?" Agree a date to follow up.

Thank them. Ask: "Who else should I talk to?"

## What Thread can honestly show

Only show and promise these; they work today.

- Upload from phone or desktop; a palette measured from the photograph (hex, Indian colour names,
  how much of the image each covers); swatch cards.
- Tags suggested by an image model, **labelled as suggestions**; weave and corrections recorded
  by a person.
- Similar pieces within your own archive: by look, same palette, or same fabric in another colour.
- Collections, the Outfit Studio (compose up to 12 pieces, colour relationships, PNG export),
  search and colour filters, Colour Lab.

Do **not** promise: styling or outfit recommendations, weave identification, client workspaces,
team accounts, sharing a collection with a client, or a public catalogue for other accounts.
If someone asks for these, write down the request: that is the evidence M11-D needs.

## Notes template

Copy one per conversation.

```
Code:            (e.g. B1)
Date:
Category:        (1-10 from the table)
How we met:
Work:            what they make/sell/style; volume per month

Current tools:
Last time story: (what actually happened, in their words)
Pain:            (time, money, lost sales; how strongly, 1-5)
Paid for a fix?: (what, how much)
Sharing today:   (how they show selections to customers/clients)

Demo reaction:   (which feature, for what; what's missing)
Requests:        (features asked for, especially sharing or recommendations)
Commitment:      yes (paid / date) / maybe (follow-up date) / no (why)
Price reaction:
Referrals:
```

## Reading the results

After about 15 conversations, count, don't summarise from memory:

| Signal | Strong | Weak |
| --- | --- | --- |
| Same problem named unprompted | 5 or more | Fewer than 3 |
| Already paying for a workaround | Any | None |
| Pilot commitments | 2 or more paid in advance | Only "sounds great" |
| Most-requested missing feature | Same one, 4 or more times | Scattered |

- **Strong** for boutiques/designers: run the setup pilot (M11-D), and build sharing only if they
  asked for it.
- **Strong** for stylists instead: re-plan around client sharing.
- **Weak** everywhere: keep Thread as a portfolio and personal tool; don't build paid features.

All prices here are test prices, chosen to learn from reactions, not market rates.
