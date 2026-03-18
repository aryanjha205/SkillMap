import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

class Database:
    def __init__(self):
        self.mongo_uri = os.getenv('MONGO_URI')
        self.db_name = os.getenv('DB_NAME', 'SkillMapDB')
        self.use_mongo = False
        self.client = None
        self.db = None
        self.last_error = None
        
        if not self.mongo_uri:
            self.last_error = 'MONGO_URI is not configured'
            print(f"CRITICAL: {self.last_error}")
            return

        try:
            self.client = MongoClient(self.mongo_uri, serverSelectionTimeoutMS=5000)
            self.client.server_info()
            self.db = self.client[self.db_name]
            self.use_mongo = True
            print("Database: Connected to MongoDB Atlas")
        except Exception as e:
            self.last_error = str(e)
            print(f"CRITICAL: MongoDB connection failed ({e})")

    def get_collection(self, name):
        if self.db is None:
            raise RuntimeError(
                f"MongoDB is not available. Configure MONGO_URI and DB_NAME before using '{name}'."
            )
        return self.db[name]

db_instance = Database()
