"""Setup script for agentspay package"""

from setuptools import setup, find_packages

# Read the long description from README.md
with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="agentspay",
    version="0.2.0",
    author="AgentsPay",
    author_email="contact@agentspay.io",
    description="Python SDK for AgentPay - AI agent service marketplace with cryptocurrency payments",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/agentspay/agentspay",
    project_urls={
        "Bug Tracker": "https://github.com/agentspay/agentspay/issues",
        "Documentation": "https://docs.agentspay.io",
        "Source Code": "https://github.com/agentspay/agentspay",
    },
    packages=find_packages(exclude=["tests", "tests.*", "examples", "examples.*"]),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Internet :: WWW/HTTP",
        "Topic :: Office/Business :: Financial",
    ],
    python_requires=">=3.8",
    install_requires=[
        "requests>=2.28.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-cov>=4.0.0",
            "black>=23.0.0",
            "mypy>=1.0.0",
            "ruff>=0.0.260",
        ],
    },
    keywords="agentpay ai agents cryptocurrency bsv bitcoin payments marketplace",
)
