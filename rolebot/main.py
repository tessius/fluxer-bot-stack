import asyncio
import os
import fluxer
import logging
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
load_dotenv()


#
# Determines how the command prefix works.
# If you want to use !setmessage <message_link>, use the default prefix type.
# If you want to use !role setmessage <message_link>, use the spaced prefix type.
#
PREFIX_TYPE = os.getenv("PREFIX_TYPE", "default").lower()
if PREFIX_TYPE == "default":
    command_prefix = os.getenv("COMMAND_PREFIX", "!")
elif PREFIX_TYPE == "spaced":
    command_prefix = os.getenv("COMMAND_PREFIX", "!") + " "
else:
    logging.error(
        f"Invalid PREFIX_TYPE '{PREFIX_TYPE}' specified. Falling back to default prefix '!'."
    )
    command_prefix = "!"

bot = fluxer.Bot(
    command_prefix=command_prefix,
    intents=fluxer.Intents.all(),
    api_url=os.getenv("FLUXER_API_URL", "https://api.fluxer.app/v1"),
)

cogs = ["admin", "reaction_handling", "util"]


@bot.event
async def on_ready():

    if bot.user is not None:
        logging.info(f"Logged in as {bot.user.username}")
    else:
        logging.warning("Failed to log in, but on_ready was called.")


async def register_cogs():
    for cog in cogs:
        await bot.load_extension(f"cogs.{cog}")
        logging.info(f"Loaded cog: {cog}")


if __name__ == "__main__":
    asyncio.run(register_cogs())
    bot.run(os.getenv("FLUXER_TOKEN", ""))
