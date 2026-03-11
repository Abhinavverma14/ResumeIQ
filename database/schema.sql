CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS candidates (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email             TEXT UNIQUE NOT NULL,
    full_name         TEXT,
    phone             TEXT,
    location          TEXT,
    linkedin_url      TEXT,
    github_url        TEXT,
    total_exp_years   NUMERIC(4,1),
    current_role      TEXT,
    current_company   TEXT,
    education         JSONB,
    work_history      JSONB,
    skills            TEXT[],
    keywords          TEXT[],
    certifications    TEXT[],
    summary           TEXT,
    strengths         TEXT[],
    gaps              TEXT[],
    match_score       NUMERIC(5,2),
    fit_label         TEXT,
    file_name         TEXT,
    drive_file_id     TEXT,
    raw_text          TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_openings (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL,
    department       TEXT,
    required_skills  TEXT[],
    keywords         TEXT[],
    min_exp_years    NUMERIC(4,1),
    max_exp_years    NUMERIC(4,1),
    is_active        BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resume_job_analysis (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id     UUID REFERENCES candidates(id),
    job_id           UUID REFERENCES job_openings(id),
    match_score      NUMERIC(5,2),
    skill_match_pct  NUMERIC(5,2),
    exp_match        BOOLEAN,
    keyword_hits     TEXT[],
    keyword_miss     TEXT[],
    ai_verdict       TEXT,
    analyzed_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(candidate_id, job_id)
);

CREATE TABLE IF NOT EXISTS analysis_errors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_name       TEXT,
    drive_file_id   TEXT,
    error_message   TEXT,
    raw_response    TEXT,
    failed_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_skills ON candidates USING GIN(skills);
CREATE INDEX IF NOT EXISTS idx_candidates_keywords ON candidates USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_candidates_exp ON candidates(total_exp_years);
CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_job_score ON resume_job_analysis(job_id, match_score DESC);