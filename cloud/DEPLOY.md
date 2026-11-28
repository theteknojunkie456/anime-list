# Deploying the sync worker

Written 2026-11-28, for the move of the list record from KV into a Durable Object
(commit "Sync: the list moves out of KV, into a Durable Object per code").

Nothing here can be run from this Mac: there is no wrangler installed, no
`CLOUDFLARE_API_TOKEN` in the environment, and the Cloudflare connector available
to Claude is signed into a different account (it can see only `bayview-coop`).
It has to be run by someone logged into the account that owns `watchlist-sync`.

## Once, to get the tools

    cd ~/Projects/ForShow/anime-list
    npx wrangler login          # opens a browser; log in as the account owner

## Deploy

    npx wrangler deploy -c cloud/sync-wrangler.toml

That config carries a new `[[migrations]] tag = "v3"` which creates the `ListBox`
class. Wrangler applies it as part of the deploy; there is no separate step and
no database to create.

## Check it worked

Push and pull a throwaway code. The second command must return the data the first
one sent, and `updatedAt` must match:

    curl -s -X POST https://watchlist-sync.muhammad-dac.workers.dev \
      -H 'Content-Type: application/json' \
      --data '{"op":"push","code":"DEPLOYCHECK1234","data":{"hello":1},"dev":"check","devName":"check","n":1}'

    curl -s -X POST https://watchlist-sync.muhammad-dac.workers.dev \
      -H 'Content-Type: application/json' \
      --data '{"op":"pull","code":"DEPLOYCHECK1234"}'

Then open the app on two devices that share a sync code: add a title on one and
pull on the other. That is the behaviour the change is really for — a Durable
Object is strongly consistent, so the pull after a push sees that push, which KV
did not guarantee.

## What happens to lists already in KV

Nothing is migrated up front. A code is read from its Durable Object first; if
that is empty, the old KV value is read AND copied across, so each list moves the
first time its owner opens the app. Until then it is still served from KV, so
there is no window where anyone's backup is missing.

## Rolling back

Deploy the previous version. Every list is still in KV as it was at migration
time, so nothing is lost that existed before the deploy — but changes pushed
AFTER the deploy live only in the Durable Object and will not be visible to the
old worker. This is safe in practice because the cloud copy is a backup and a
sync channel, not the only copy: every device still holds its own list, and the
first push after a rollback republishes it. Tell people to open the app once.

## Why this was done

The free KV plan allows 1,000 writes a day across the whole account, and every
push spent one; the quota was running out while people were still using the app.
The free Durable Object SQLite storage allows about 100,000 writes a day. The
rest of the worker's KV writes are human-initiated (adding a device, sending a
recommendation, accepting a friend) or belong to features cut from v1, and the
notify worker reads before writing on check-in and dedupes its updates on the
client, so nothing else is spending the quota in the background.
