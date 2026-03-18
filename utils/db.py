import copy
import os
import re
from types import SimpleNamespace

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()


def _get_nested_value(document, dotted_key):
    value = document
    for part in dotted_key.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _matches_query(document, query):
    if not query:
        return True

    for key, expected in query.items():
        actual = _get_nested_value(document, key)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$regex" in expected:
                pattern = expected["$regex"]
                flags = re.IGNORECASE if "i" in expected.get("$options", "") else 0
                if not re.search(pattern, str(actual or ""), flags):
                    return False
        elif actual != expected:
            return False
    return True


class InMemoryCursor:
    def __init__(self, documents):
        self._documents = [copy.deepcopy(doc) for doc in documents]

    def sort(self, key, direction):
        reverse = direction == -1
        self._documents.sort(key=lambda doc: _get_nested_value(doc, key) or "", reverse=reverse)
        return self

    def __iter__(self):
        return iter(self._documents)


class InMemoryCollection:
    def __init__(self):
        self.documents = []

    def find(self, query=None):
        return InMemoryCursor([doc for doc in self.documents if _matches_query(doc, query or {})])

    def find_one(self, query=None):
        for doc in self.documents:
            if _matches_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def insert_one(self, document):
        self.documents.append(copy.deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    def insert_many(self, documents):
        for document in documents:
            self.documents.append(copy.deepcopy(document))
        return SimpleNamespace(inserted_ids=[doc.get("id") for doc in documents])

    def count_documents(self, query=None):
        return len([doc for doc in self.documents if _matches_query(doc, query or {})])

    def update_one(self, query, update, upsert=False):
        matched = 0
        modified = 0
        for index, doc in enumerate(self.documents):
            if _matches_query(doc, query):
                matched = 1
                if "$set" in update:
                    self.documents[index].update(copy.deepcopy(update["$set"]))
                    modified = 1
                break

        if matched == 0 and upsert:
            new_doc = copy.deepcopy(query)
            if "$set" in update:
                new_doc.update(copy.deepcopy(update["$set"]))
            self.documents.append(new_doc)
            matched = 1
            modified = 1

        return SimpleNamespace(matched_count=matched, modified_count=modified)

    def update_many(self, query, update):
        matched = 0
        modified = 0
        for index, doc in enumerate(self.documents):
            if _matches_query(doc, query):
                matched += 1
                if "$set" in update:
                    self.documents[index].update(copy.deepcopy(update["$set"]))
                    modified += 1
        return SimpleNamespace(matched_count=matched, modified_count=modified)

    def delete_one(self, query):
        for index, doc in enumerate(self.documents):
            if _matches_query(doc, query):
                self.documents.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class Database:
    def __init__(self):
        self.mongo_uri = os.getenv("MONGO_URI")
        self.db_name = os.getenv("DB_NAME", "SkillMapDB")
        self.use_mongo = False
        self.client = None
        self.db = None
        self.last_error = None
        self._memory_collections = {}

        if not self.mongo_uri:
            self.last_error = "MONGO_URI is not configured. Using temporary in-memory storage."
            print(f"WARNING: {self.last_error}")
            return

        try:
            self.client = MongoClient(self.mongo_uri, serverSelectionTimeoutMS=5000)
            self.client.server_info()
            self.db = self.client[self.db_name]
            self.use_mongo = True
            print("Database: Connected to MongoDB Atlas")
        except Exception as exc:
            self.last_error = f"{exc}. Using temporary in-memory storage."
            print(f"WARNING: MongoDB connection failed ({exc})")

    def get_collection(self, name):
        if self.db is not None:
            return self.db[name]
        if name not in self._memory_collections:
            self._memory_collections[name] = InMemoryCollection()
        return self._memory_collections[name]


db_instance = Database()
