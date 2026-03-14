from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import psycopg2
import psycopg2.extras
from psycopg2 import Error as PsycopgError
import os
import requests
import json
import pypdf
import io
import logging
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="ResumeIQ API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


def _safe_text_list(value):
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _extract_json_object(text):
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _none_if_empty(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip().lower() in {"", "null", "none", "n/a", "na"}:
        return None
    return value


def _to_float(value, default=0.0):
    try:
        if value is None or (isinstance(value, str) and not value.strip()):
            return float(default)
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _normalize_analysis_data(data):
    normalized = {
        "full_name": _none_if_empty(data.get("full_name")),
        "email": _none_if_empty(data.get("email")),
        "phone": _none_if_empty(data.get("phone")),
        "location": _none_if_empty(data.get("location")),
        "linkedin_url": _none_if_empty(data.get("linkedin_url")),
        "github_url": _none_if_empty(data.get("github_url")),
        "total_exp_years": _to_float(data.get("total_exp_years"), default=0),
        "current_role": _none_if_empty(data.get("current_role") or data.get("current_job_role")),
        "current_company": _none_if_empty(data.get("current_company")),
        "education": data.get("education") if isinstance(data.get("education"), list) else [],
        "work_history": data.get("work_history") if isinstance(data.get("work_history"), list) else [],
        "skills": _safe_text_list(data.get("skills")),
        "keywords": _safe_text_list(data.get("keywords")),
        "certifications": _safe_text_list(data.get("certifications")),
        "summary": _none_if_empty(data.get("summary")),
        "strengths": _safe_text_list(data.get("strengths")),
        "gaps": _safe_text_list(data.get("gaps")),
        "match_score": _to_float(data.get("match_score"), default=0),
        "fit_label": _none_if_empty(data.get("fit_label")),
    }
    return normalized


def _get_env(name, required=True, default=None):
    value = os.getenv(name, default)
    if required and (value is None or str(value).strip() == ""):
        raise HTTPException(status_code=500, detail=f"Missing environment variable: {name}")
    return value

def get_db():
    return psycopg2.connect(
        host=_get_env("DB_HOST"),
        port=_get_env("DB_PORT"),
        dbname=_get_env("DB_NAME"),
        user=_get_env("DB_USER"),
        password=_get_env("DB_PASSWORD"),
        connect_timeout=10,
    )

def extract_text_from_pdf(file_bytes):
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        return text.strip()
    except Exception as exc:
        logger.exception("Failed to parse PDF")
        raise HTTPException(status_code=400, detail=f"Invalid or unreadable PDF: {str(exc)}")

def analyze_with_ollama(resume_text):
    ollama_url = _get_env("OLLAMA_URL")
    ollama_model = _get_env("OLLAMA_MODEL")

    prompt = f"""You are an expert resume parser. Extract information from the resume below and return ONLY a valid JSON object. No explanation, no markdown, just JSON.

Resume:
{resume_text}

Return exactly this JSON structure:
{{
  "full_name": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "linkedin_url": "string or null",
  "github_url": "string or null",
  "total_exp_years": 0,
  "current_role": "string or null",
  "current_company": "string or null",
  "education": [],
  "work_history": [],
  "skills": [],
  "keywords": [],
  "certifications": [],
  "summary": "string or null",
  "strengths": [],
  "gaps": [],
  "match_score": 0,
  "fit_label": "string or null"
}}"""

    try:
        response = requests.post(
            f"{ollama_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": prompt,
                "stream": False,
                "format": "json"
            },
            timeout=180
        )
        response.raise_for_status()
        result = response.json()
    except requests.exceptions.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Ollama: {str(exc)}")
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid Ollama response format: {str(exc)}")

    raw_response = result.get("response")
    if not raw_response:
        raise HTTPException(status_code=502, detail="Ollama response missing 'response' field")

    try:
        parsed = _extract_json_object(raw_response)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama returned non-JSON output: {str(exc)}")

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Ollama returned JSON but not an object")
    return _normalize_analysis_data(parsed)

def save_candidate(data, file_name, raw_text):
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
        INSERT INTO candidates (
            email, full_name, phone, location,
            linkedin_url, github_url, total_exp_years,
            current_job_role, current_company, education,
            work_history, skills, keywords, certifications,
            summary, strengths, gaps, match_score, fit_label,
            file_name, raw_text, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
        )
        ON CONFLICT (email) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            phone = EXCLUDED.phone,
            location = EXCLUDED.location,
            total_exp_years = EXCLUDED.total_exp_years,
            current_job_role = EXCLUDED.current_job_role,
            current_company = EXCLUDED.current_company,
            skills = EXCLUDED.skills,
            keywords = EXCLUDED.keywords,
            summary = EXCLUDED.summary,
            strengths = EXCLUDED.strengths,
            gaps = EXCLUDED.gaps,
            match_score = EXCLUDED.match_score,
            fit_label = EXCLUDED.fit_label,
            updated_at = NOW()
        RETURNING id
    """, (
        (data.get("email") or "unknown@unknown.com").strip().lower(),
        data.get("full_name"),
        data.get("phone"),
        data.get("location"),
        data.get("linkedin_url"),
        data.get("github_url"),
        float(data.get("total_exp_years") or 0),
        data.get("current_role"),
        data.get("current_company"),
        json.dumps(data.get("education") or []),
        json.dumps(data.get("work_history") or []),
        _safe_text_list(data.get("skills")),
        _safe_text_list(data.get("keywords")),
        _safe_text_list(data.get("certifications")),
        data.get("summary"),
        _safe_text_list(data.get("strengths")),
        _safe_text_list(data.get("gaps")),
        float(data.get("match_score") or 0),
        data.get("fit_label"),
        file_name,
        raw_text
    ))

        candidate_id = cur.fetchone()[0]
        conn.commit()
        return str(candidate_id)
    except (ValueError, TypeError) as exc:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=400, detail=f"Invalid parsed resume values: {str(exc)}")
    except PsycopgError as exc:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database write failed: {str(exc)}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@app.get("/")
def root():
    return {"message": "ResumeIQ API is running!"}


@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/upload-resume")
async def upload_resume(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files supported")

    file_bytes = await file.read()
    resume_text = extract_text_from_pdf(file_bytes)

    if not resume_text:
        raise HTTPException(status_code=400, detail="Could not extract text from PDF")

    try:
        analyzed_data = analyze_with_ollama(resume_text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama error: {str(e)}")

    try:
        candidate_id = save_candidate(analyzed_data, file.filename, resume_text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return {
        "success": True,
        "candidate_id": candidate_id,
        "data": analyzed_data
    }

@app.get("/candidates")
def get_candidates(
    skills: Optional[str] = None,
    min_exp: Optional[float] = None,
    max_exp: Optional[float] = None,
    keyword: Optional[str] = None,
    limit: int = 50
):
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        query = "SELECT * FROM candidates WHERE 1=1"
        params = []

        if skills:
            skill_list = [s.strip() for s in skills.split(",") if s.strip()]
            if skill_list:
                query += " AND skills @> %s::text[]"
                params.append(skill_list)

        if min_exp is not None:
            query += " AND total_exp_years >= %s"
            params.append(min_exp)

        if max_exp is not None:
            query += " AND total_exp_years <= %s"
            params.append(max_exp)

        if keyword and keyword.strip():
            query += " AND keywords @> %s::text[]"
            params.append([keyword.strip()])

        query += " ORDER BY match_score DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, params)
        candidates = cur.fetchall()
        return {"candidates": [dict(c) for c in candidates]}
    except PsycopgError as exc:
        raise HTTPException(status_code=500, detail=f"Database read failed: {str(exc)}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@app.get("/candidates/{candidate_id}")
def get_candidate(candidate_id: str):
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM candidates WHERE id = %s", (candidate_id,))
        candidate = cur.fetchone()
    except PsycopgError as exc:
        raise HTTPException(status_code=500, detail=f"Database read failed: {str(exc)}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    return dict(candidate)